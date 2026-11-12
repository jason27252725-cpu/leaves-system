import {getCoreApi} from 'leaves:core-api/v1';
import {mountWorkforce} from './workforce.mjs';
export const moduleInfo=Object.freeze({"module":"workforce","version":"0.1.0-alpha.31","environment":"stable","apiVersion":1,"activation":"safe-point","lifecycleVersion":1});
export const mount=(root,api=getCoreApi())=>mountWorkforce(root,api);
