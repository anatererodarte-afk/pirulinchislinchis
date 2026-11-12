import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html=readFileSync('public/index.html','utf8');
function page(authenticated=false,hash='',previousProgress=null) {
  const errors=[];
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:'https://example.com/'+hash,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    if(previousProgress)w.localStorage.setItem('cumple-day-v3',JSON.stringify(previousProgress));
    w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=()=>{};
    w.alert=()=>{};w.prompt=()=>null;
    w.fetch=async url=>({ok: url.endsWith('/auth') ? authenticated : true,status:authenticated?200:401,json:async()=>[]});
  }});
  return {dom,errors};
}
test('public welcome hides progress and keeps the owner panel private',async()=>{
  const {dom,errors}=page();
  await new Promise(r=>setTimeout(r,30));
  assert.equal(dom.window.document.querySelector('#introProg'),null);
  assert.equal(dom.window.document.querySelector('#owner').hidden,true);
  assert.equal(dom.window.EDIT,false);
  assert.equal(dom.window.document.querySelectorAll('#photos .unlocked').length,0);
  const photo=dom.window.document.querySelector('#photos .ph');
  assert.equal(dom.window.getComputedStyle(photo).visibility,'hidden');
  assert.deepEqual(errors,[]);
  dom.window.close();
});
test('an edit URL cannot display progress without authentication',async()=>{
  const {dom,errors}=page(false,'#editar');
  await new Promise(r=>setTimeout(r,30));
  assert.equal(dom.window.document.querySelector('#owner').hidden,true);
  assert.equal(dom.window.EDIT,false);
  assert.deepEqual(errors,[]);
  dom.window.close();
});
test('a verified admin can open the progress panel and photo editor',async()=>{
  const {dom,errors}=page(true,'#editar');
  await new Promise(r=>setTimeout(r,30));
  assert.equal(dom.window.document.querySelector('#owner').hidden,false);
  assert.equal(dom.window.EDIT,true);
  assert.equal(dom.window.document.querySelector('#adminLogout').hidden,false);
  assert.equal(dom.window.document.querySelectorAll('#photos .padd').length,6);
  assert.equal(dom.window.document.querySelectorAll('#photos .unlocked').length,6);
  const photo=dom.window.document.querySelector('#photos .ph');
  assert.equal(dom.window.getComputedStyle(photo).visibility,'visible');
  dom.window.EDIT=false;
  dom.window.photoLock();
  assert.equal(dom.window.getComputedStyle(photo).visibility,'hidden');
  assert.deepEqual(errors,[]);
  dom.window.close();
});

test('the new game starts from zero even when previous progress exists',async()=>{
  const {dom,errors}=page(false,'',{pts:999,hi:999,dp:80,rp:80,done:[0,1],tri:{0:1},geo:{0:1},pend:0,nm:'Anterior'});
  await new Promise(r=>setTimeout(r,30));
  const state=JSON.parse(dom.window.localStorage.getItem('cumple-day-v4'));
  assert.equal(state.pts,0);
  assert.equal(state.hi,0);
  assert.equal(state.dp,0);
  assert.equal(state.rp,0);
  assert.deepEqual(state.done,[]);
  assert.deepEqual(state.tri,{});
  assert.deepEqual(state.geo,{});
  assert.equal(state.pend,null);
  assert.equal(state.uid.slice(0,8),'c612a904');
  assert.equal(dom.window.document.querySelectorAll('#photos .unlocked').length,0);
  assert.equal(dom.window.document.querySelector('#score b').textContent,'0');
  assert.deepEqual(errors,[]);
  dom.window.close();
});
