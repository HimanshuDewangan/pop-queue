
# pop-queue

### Redis and Mongo backed light weight job queue
Install package via npm
```
npm i pop-queue
```
Lets start with creating an exporter file *queue.js*
```

import { PopQueue } from 'pop-queue';

const dbUrl = {
	uri: 'mongodb://localhost:27017',
	options: {
		useUnifiedTopology: true // Optional
	}
}
const redis = {
	port: '6379',
	host: '127.0.0.1',
	password: '*******'
}
const dbName = 'pqueuedb' // default is circledb

const pQueue = new PopQueue(
	dbUrl,
	redis,
	dbName,
	"pop_queues" // default collection name. Can be different for different processes
)

export const popQueue = pQueue

```

Now, lets create a runner function  *runner.js*

```

import { popQueue } from 'queue.js';

function runner1(job) {
	try {
		console.log("job 1 ran");
	} catch(err) {
		throw new Error("Error while running runner 1");
	}
}

function runner2(job) {
	try {
		console.log("job 2 ran");
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

Finally, we need a file to push jobs to queue *init.js*

```
import { popQueue } from 'queue.js';

setInterval(() => {
	popQueue.now(
		{name: "job_" + parseInt(Math.random() * 100)}, // data
		"job1"
	)
}, 10 * 1000);

setInterval(() => {
	popQueue.now(
		{name: "job_" + parseInt(Math.random() * 100)}, // data
		"job2"
	)
}, 8 * 1000);

```