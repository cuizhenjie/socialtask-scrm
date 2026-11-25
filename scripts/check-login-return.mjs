import assert from 'node:assert/strict';
import {cardReturnPath,loginUrl,afterLoginPath} from '../apps/web/src/lib/login-return.ts';
let checks=0;
function eq(actual,expected){assert.equal(actual,expected);checks++;}
eq(cardReturnPath('/m/tasks/42'),'/m/tasks/42');
eq(loginUrl('/m/tasks/42'),'/login?next=%2Fm%2Ftasks%2F42');
eq(afterLoginPath(new URLSearchParams('next=%2Fm%2Ftasks%2F42').get('next'),'worker'),'/m/tasks/42');
eq(afterLoginPath(null,'admin'),'/admin');
eq(afterLoginPath(null,'manager'),'/admin');
eq(afterLoginPath(null,'worker'),'/m');
for(const bad of ['https://example.invalid','//example.invalid','/\\example.invalid','javascript:alert(1)','/admin','/m/tasks/0','/m/tasks/1/../2','/m/tasks/1?x=y','/m/tasks/1#x','/m/tasks/1\n','/m/tasks/%31','/m/tasks/01','/m/tasks/1/']){
  eq(cardReturnPath(bad),null);eq(afterLoginPath(bad,'worker'),'/m');
}
console.log(`PASS: ${checks} card login-return assertions`);
