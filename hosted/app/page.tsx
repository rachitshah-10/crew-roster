'use client';
import { useEffect } from 'react';
export default function Home(){
 useEffect(()=>{if(document.querySelector('script[data-crewcheck]'))return;const script=document.createElement('script');script.src='/static/app.js';script.dataset.crewcheck='true';document.body.appendChild(script)},[]);
 return <><link rel="stylesheet" href="/static/styles.css"/><div id="app"><div className="boot">Opening CrewCheck…</div></div><div id="toast" role="status" aria-live="polite"/><div id="drawer-root"/></>;
}
