import Redis from 'ioredis';

export async function main(redis) {
    return new Redis(redis)
}
export default main;