
import * as mongodb from 'mongodb';
let MongoClient = mongodb.MongoClient;

// Connection URL


export async function main(url, dbName) {
  let client = new MongoClient(url);
  await client.connect();
  console.log('Connected successfully to server');
  return client.db(dbName);
}

export const objectId = mongodb.ObjectId;

export default main;