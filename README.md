
# pop-queue

### Redis and Mongo backed light weight job queue
Install package via npm
```
npm i pop-queue
```

Pre-requisites:
1. [MongoDB](https://docs.mongodb.com/v4.0/installation/)
2. [Redis](https://redis.io/download)

The queue is maintained as redis array.
> Concurrency is always 1. To run multiple simultaneous runners, fork with pm2.
> 10 sec idle time (gap between array pop) when no jobs are queued.

Lets start with creating an exporter file *queue.js*
```

import { PopQueue } from 'pop-queue';

const dbUrl = 'mongodb://localhost:27017';
const redis = {
	port: '6379',
	host: '127.0.0.1',
	password: '*******'
}
const dbName = 'pqueuedb' // default is circledb

export const popQueue = new PopQueue(
	dbUrl,
	redis,
	dbName,
	"pop_queues" // default collection name. Can be different for different runners
)

```

Now, lets create runner functions  *runner.js*. Each runner pops a job by name and executes it.

```
import { popQueue } from './queue.js';

function runner1(job) {
	try {
		console.log("job 1 ran", job.data.name);
	} catch(err) {
		throw new Error("Error while running runner 1");
	}
}

function runner2(job) {
	try {
		console.log("job 2 ran", job.data.name);
	} catch(err) {
		throw new Error("Error while running runner 2");
	}
}

popQueue.define(
	"job1", // Runner name (unique)
	runner1
)
popQueue.define(
	"job2", // Runner name (unique)
	runner2
)

popQueue.connect().then(async (err) => {
	if(err) {
		throw err;
	}
	await popQueue.start();
})

```

Finally, we need a file to push jobs to queue *scheduler.js*. This is to emulate job addition is queue.

```
import { popQueue } from './queue.js';

setInterval(() => {
    let name = getJobName();
	popQueue.now(
		{ name }, // data
		"job1"
	)
    console.log("Pushing job1", name);
}, 10 * 1000);

setInterval(() => {
    let name = getJobName();
	popQueue.now(
		{ name }, // data
		"job2"
	)
    console.log("Pushing job2", name);
}, 8 * 1000);


function getJobName() {
    return "job_" + parseInt(Math.random() * 100)
}

```