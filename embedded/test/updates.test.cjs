'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { coalesceUpdates } = require('../src/updates.cjs');
test('a burst sends one latest snapshot and a later event schedules another', () => {
  const jobs=new Map(),sent=[];let next=0,value='initial';
  const notify=coalesceUpdates(()=>sent.push(value),50,(fn,delay)=>{assert.equal(delay,50);jobs.set(++next,fn);return next;},id=>jobs.delete(id));
  for(let i=0;i<100;i++){value=`latest-${i}`;notify();}
  assert.equal(jobs.size,1);assert.deepEqual(sent,[]);
  const [id,fn]=[...jobs][0];jobs.delete(id);fn();assert.deepEqual(sent,['latest-99']);
  value='later';notify();assert.equal(jobs.size,1);
  notify.cancel();assert.equal(jobs.size,0);assert.equal(sent.length,1);
  notify();const callback=[...jobs.values()][0];callback();assert.deepEqual(sent,['latest-99','later']);
});
test('an urgent UI change cancels the pending batch and immediately sends current state', () => {
  const jobs=new Map(),sent=[];let value='old';
  const notify=coalesceUpdates(()=>sent.push(value),50,fn=>{jobs.set(1,fn);return 1;},id=>jobs.delete(id));
  notify();value='selected-new';notify.flush();assert.deepEqual(sent,['selected-new']);assert.equal(jobs.size,0);
});
