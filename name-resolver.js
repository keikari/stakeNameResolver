const http = require('http');
const fs = require('fs');

const hostname = '127.0.0.1';
const port = 3001;
const contractTxid = "UohY2ipdFmdtSYopPy8ieJTDQChGQZnbfDrG2VtFpOU";
const maxUndernamesDataSizeBytes = 100000;

const cachedState = {
    state: {},
    lastUpdated: 0
}

function getNameToResolve(req) {
    const headers = req.headers;
    const host = headers.host;
    const match = host.match(/^[^.]+/);
    if (match.length > 0) {
      const  [name1, name2] = match[0].split('_');
      if (name2) {
        return [name2, name1];
      } else {
        return [name1];
      }
    }
}

async function getContractState() {
    const now = Math.round(Date.now() / 1000);
    const shouldFetchState = Object.keys(cachedState.state).length === 0 || (cachedState.lastUpdated + 10) < now;
    if (shouldFetchState) {
        try {
            console.log("Fetchin contract state...");
            const url = `https://dre-1.warp.cc/contract?id=${contractTxid}&events=false`;
            const response = await fetch(url)
            const result = await response.json();
            cachedState.state = result.state;
            cachedState.lastUpdated = now;
        } catch (e){
            console.log(e);
            throw new Error(`Failed to get contract state`);
        }
    }
    
    return cachedState.state;
}

function resolveName(state, name) {
    const txid = state.records && state?.records[name]?.targetTxid || null;
    if (!txid) {
        throw new Error(`Couldn't resolve name: ${name}`);
    }
    return txid;
}

async function resolveUndername(txid, name) {
    try {
        const cacheDir = `./cachedUndernames`;
        const cachePath = `${cacheDir}/${txid}`;
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir);
        }
        let undernames;
        if (!(fs.existsSync(cachePath))) {
            console.log("Fetching undernames:", txid);
            const url = `https://arweave.net/${txid}`;
            const response = await fetch(url, {
                headers: {
                    Range: `bytes=0-${maxUndernamesDataSizeBytes}`,
                }
            });

            undernames = await response.json();
        } else {
            undernames = JSON.parse(fs.readFileSync(cachePath));
        }
        let resolvedTxid = null;
        if ("names" in undernames) { 
            resolvedTxid = undernames.names[name];
        };
        if (!resolvedTxid) throw new Error(`resolvedTxid is null`);

        fs.writeFileSync(cachePath, JSON.stringify(undernames));
        return resolvedTxid;
    } catch (e) {
        console.log(e);
        throw new Error(`Couldn't resolve undername: ${name}`);
    }
}

async function main() {
    const server = http.createServer(async (req, res) => {
        try {
            const [name, undername] = getNameToResolve(req);
            console.log(name, undername);
            const state = await getContractState();

            const recordExists = name in state.records;
            if (!recordExists) throw new Error(`Couldn't find record for ${name}`);

            let txid = null;
            if (undername && !state.records[name].underNamesTxid) throw new Error(`${name} doesn't have undernames`);
            if (undername) {
                txid = await resolveUndername(state.records[name].underNamesTxid, undername);
            } else {
                txid = resolveName(state, name);
            }
           
            console.log(`Resolved txid for ${undername ? undername + "_":""}${name}: ${txid}`);

            res.statusCode = 200;
            res.setHeader('x-arns-resolved-id', txid);
            res.setHeader('Content-Type', 'text/plain');
            res.end();
        } catch (e) {
            console.log(e);
            res.statusCode = 200;
            res.end(e.message);
        }
      });
      
      server.listen(port, hostname, () => {
        console.log(`Server running at http://${hostname}:${port}/`);
      });

}

main();