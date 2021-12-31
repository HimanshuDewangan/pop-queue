
import mongoClient, { objectId } from './mongo.js';
import redisClient from './redis.js';
import { sleep, parseDocFromRedis } from './helpers.js'

export class PopQueue {

    constructor(dbUrl, redis, dbName, cName, retries) {
        this.dbUrl = dbUrl;
        this.redis = redis;
        this.cName = cName || "pop_queues";
        this.dbName = dbName || "circle";
        this.retries = retries || 3;
        this.runners = {};
        this.loopRunning = false;
    }

    async define(name, fn, options = {}) {
        this.runners[name] = {
            fn,
            options,
            cName: options.cName || "pop_queues"
        };
    }

    async start(runLoop) {
        await this.startLoop();
        setInterval(async () => {
            if (!this.loopRunning) {
                await this.startLoop();
            }
        }, 0.25 * 60 * 1000)
    }

    getDbCollectionName(name) {
        if (this.runner && this.runners[name] && this.runners[name].cName) {
            return this.runners[name].cName
        } else {
            return this.cName;
        }
    }

    async startLoop() {
        let names = Object.keys(this.runners);
        if (names.length) {
            this.loopRunning = true;
            while (true) {
                let counter = 0;
                for (let name of names) {
                    try {
                        await this.run(name);
                    } catch (e) {
                        if (e.code == 404) {
                            counter++;
                        }
                    }
                }
                if (counter == names.length) {
                    this.loopRunning = false
                    break;                    
                }
            }
        }
    }

    async connect() {
        await Promise.all([this.connectDb(), this.connectRedis()]);
    }

    async connectDb() {
        try {
            this.db =  await mongoClient(this.dbUrl, this.dbName);
        } catch(e) {
            console.log(e);        
        }
    }

    async connectRedis() {
        try {
            this.redisClient =  await redisClient(this.redis);
        } catch(e) {
            console.log(e);        
        }
    }

    async now(job, name) {
        try {
            let document = {_id: objectId().toString(), data: job, created_on: new Date(), name};
            if (!this.db) {
                await this.connect();
            }
            await this.db.collection(this.getDbCollectionName(name)).insertOne(document);
            await this.pushToQueue(document, name);
        } catch(e) {
            console.log(e);        
        }
    }

    async pushToQueue(document, name) {
        try {
            await this.redisClient.lpush(`pop:queue:${name}`, JSON.stringify(document));
        } catch (e) {
            console.log(e);
        }
    }

    async pop(name) {
        try {
            let stringDocument = await this.redisClient.rpop(`pop:queue:${name}`);
            if (!stringDocument) {
                return null;
            }
            let document = parseDocFromRedis(stringDocument);
            let pickedTime = new Date();
            document.pickedAt = pickedTime;
            await this.db.collection(this.getDbCollectionName(name)).findOneAndUpdate({
                _id: document._id
            }, {
                $inc: {
                    attempts: 1
                },
                $set: {
                    pickedAt: new Date(pickedTime)
                }
            });
            return document;
        } catch(e) {
            console.log(e);        
        }
    }

    async finish(document) {
        try {
            let finishTime = new Date();
            await this.db.collection(this.getDbCollectionName(document.name)).findOneAndUpdate({
                _id: document._id
            }, {
                $set: {
                    finishedAt: finishTime,
                    duration: finishTime - document.pickedAt,
                    delay: finishTime - document.created_on,
                    status: 'done'
                }
            });
        } catch (e) {
            console.log(e)
        }
    }

    async fail(document, reason, force) {
        try {
            if (document.attempts >= this.retries && !force) {
                let finishTime = new Date();
                await this.db.collection(this.getDbCollectionName(document.name)).findOneAndUpdate({
                    _id: document._id
                }, {
                    $push: {
                        failedReason: {
                            reason, 
                            time: new Date()
                        },
                    },
                    $set: {
                        finishedAt: finishTime,
                        status: 'failed',
                        requeuedAt: new Date()
                    }
                });
            } else {
                let newDocument = await this.db.collection(this.getDbCollectionName(document.name)).findOneAndUpdate({
                    _id: document._id
                }, {
                    $unset: {
                        pickedAt: 1,
                        finishedAt: 1,
                        status: 1,
                        duration: 1
                    },
                    $push: {
                        failedReason: {
                            reason, 
                            time: new Date()
                        },
                        runHistory: {
                            pickedAt: document.pickedAt,
                            finishedAt: document.finishedAt,
                            status: document.status,
                            duration: document.duration
                        }
                    },
                    $set: {
                        requeuedAt: new Date()
                    }
                }, {new: true});
                if(newDocument.value && newDocument.value.name) {
                    await this.pushToQueue(newDocument.value, newDocument.value.name);
                }
            }
        } catch (e) {
            console.log(e)
        }
    }

    async run(name) {
        let job = await this.pop(name);
        if (!job) {
            let error = new Error(`No job for ${name}`);
            error.code = 404;
            throw error;
        }
        try {
            if (this.runners[name] && this.runners[name].fn) {
                try {
                    let fnTimeout = setTimeout(() => {
                        throw new Error("Timeout");
                    }, (this.runners[name].options && this.runners[name].options.timeout) || 10 * 60 * 1000)
                    await this.runners[name].fn(job);
                    await this.finish(job);
                    clearTimeout(fnTimeout);
                } catch(err) {
                    console.log(err);
                    await this.fail(job, err.toString());
                }
            } else {
                await this.fail(job, `Runner ${name} not defined`);
                throw new Error('Runner not defined');
            }
        } catch(e) {
            console.log(e);
        }
    }

    async getQueueLength(name) {
        return await this.redisClient.llen(`pop:queue:${name}`);
    }

    async getCurrentQueue(name) {
        let docs =  await this.redisClient.lrange(`pop:queue:${name}`, 0 , - 1);
        docs = docs.filter(d => d).map(d => parseDocFromRedis(d));
        return docs
    }

    async getCountInLastNHours(name, n) {
        let startTime = new Date(Date.now() - n * 60 * 60 * 1000);
        let oId = objectId.createFromTime(startTime.getTime() / 1000);
        let filter = {
            _id: {
                $gte: oId.toString(),
            },
            name
        };
        let count = await this.db.collection(this.getDbCollectionName(name)).count(filter);
        return count;
    }

    async getPaginatedExecutedQueue(name, { lastNDays = 1, skip, limit, sort, search, status }) {
        let startOfNDay = new Date(Date.now() - lastNDays * 24 * 60 * 60 * 1000);
        startOfNDay.setUTCHours(0,0,0,0);
        let oId = objectId.createFromTime(startOfNDay.getTime() / 1000);
        let filter = {
            _id: {
                $gte: oId.toString(),
            },
            name
        };
        if (search) {
            filter['$or'] = [{
                "data.mediaId": search
            }, {
                "data.contentNumber": parseInt(search)
            }]
        }

        if (status === "failed") {
            filter.status = status
        }
        let docs = await this.db.collection(this.getDbCollectionName(name)).find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();
        return docs
    }

    async requeueJob(name, documentId) {
        try {
            let doc = await this.db.collection(this.getDbCollectionName(name)).findOne({
                _id: documentId
            });
            await this.fail(doc, "Unknown, manually Requeued", true)
        } catch(e) {
            console.log(e);
        }
    }
}
