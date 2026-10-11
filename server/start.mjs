try{process.loadEnvFile();}catch(e){if(e.code!=='ENOENT')throw e;}
import express from 'express';
import {api} from './api.mjs';
const app=api();
app.use(express.static('dist'));
app.get(['/', '/login', '/register', '/pending', '/dashboard', '/admin'],(_req,res)=>res.sendFile('index.html',{root:'dist'}));
const port=Number(process.env.PORT)||5173;
const host=process.env.HOST||'0.0.0.0';
app.listen(port,host,()=>console.log('CMG http://'+host+':'+port));
