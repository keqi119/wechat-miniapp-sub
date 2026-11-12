// Local synthetic mounting harness for the production FinalPlanForm, no real API writes.
import React from 'react';import {createRoot} from 'react-dom/client';import {FinalPlanForm} from '../src/final-plan-form';import {resources} from '../src/resources';import {api} from '../src/core';import '../src/style.css';
api.setSession({user:{id:'synthetic-admin',username:'本地合成',role:'ADMIN',permissions:['*']},csrfToken:'local-fixture-not-real'});
const fields=resources.find(r=>r.key==='applications')!.actions!.find(a=>a.path==='final-plan')!.fields!;
createRoot(document.getElementById('root')!).render(<main style={{padding:24}}><h1>本地合成 · 实际电子报价表单</h1><FinalPlanForm entity={{id:'fixture-application',revision:4}} fields={fields} onSubmit={async body=>{console.log('SYNTHETIC_ONLY',body);}} onCancel={()=>history.back()}/></main>);
