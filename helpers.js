export const sleep = async (ms) => new Promise(r => setTimeout(r, ms));

export function parseDocFromRedis(docStr) {
    try {
        let doc = JSON.parse(docStr);
        doc.created_on = new Date(doc.created_on);
        return doc;
    } catch(err) {
        console.log("error parsing doc from redis", e)
    }
}