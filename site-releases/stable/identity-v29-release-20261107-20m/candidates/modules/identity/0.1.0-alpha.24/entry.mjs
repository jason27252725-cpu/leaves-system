import {getCoreApi} from 'leaves:core-api/v1';
import {mountPeople} from './identity.core.mjs';
export const moduleInfo=Object.freeze({"module":"identity","version":"0.1.0-alpha.24","environment":"stable","apiVersion":1,"activation":"next-login","handoverVersion":1});
export const mount=(root,api=getCoreApi())=>mountPeople(root,api);
