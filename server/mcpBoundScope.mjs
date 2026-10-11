import {verifyMcpScope} from './mcpScope.mjs';

// Credentials and project identity come from the authenticated transport,
// never from model-generated arguments. Legacy bridge clients retain their
// existing signed-argument protocol when this header is absent.
export function bindMcpTools(server, token) {
 if (token === undefined) return server;
 const scope=verifyMcpScope(token);
 return {registerTool(name,config,handler){
  const inputSchema=Object.fromEntries(Object.entries(config.inputSchema||{}).filter(([key])=>key!=='scope_token'&&key!=='project_id'));
  return server.registerTool(name,{...config,inputSchema},(args,extra)=>{
   verifyMcpScope(token,{projectId:scope.projectId,requestId:scope.requestId});
   return handler({...args,scope_token:token,project_id:scope.projectId},extra);
  });
 }};
}
