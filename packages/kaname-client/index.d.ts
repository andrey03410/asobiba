import type { FastifyInstance, FastifyReply } from 'fastify';
export interface Grant {
  subject:string; login:string; service:string; role:'user'|'admin'|'overlord';
  limits:Record<'storageBytes'|'items'|'configs'|'lobbies'|'groups'|'projects'|'publications',number|null>;
  permissions:{heavy:boolean; html:boolean};
}
export function kanameEnabled():boolean;
export function problem(statusCode:number,message:string):Error & {statusCode:number};
export function reportAuthorized(header:string|undefined):boolean;
export function access(service:string,subject:string|null|undefined):Promise<Grant>;
export function registerLogin(app:FastifyInstance,service:string,signIn:(grant:Grant,reply:FastifyReply)=>Promise<void>):void;
