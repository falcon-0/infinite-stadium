import {createServer} from './server.js';
import {serverSettings} from './server-settings.js';
const env={...process.env,AI_PROVIDER:'local',HOST:'127.0.0.1'};
const settings=serverSettings(env);
createServer({env}).listen(settings.port,settings.host,()=>console.log(`Infinite Stadium local AI: http://${settings.host}:${settings.port}`));
