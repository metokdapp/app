import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Card({children,className=''}:{children:ReactNode,className?:string}){return <section className={`card ${className}`}>{children}</section>}
export function Label({children}:{children:ReactNode}){return <div className="eyebrow">{children}</div>}
export function Badge({children,ok=true}:{children:ReactNode,ok?:boolean}){return <span className={`badge ${ok?'ok':'warn'}`}><i/>{children}</span>}
export function Button({children,className='',...p}:ButtonHTMLAttributes<HTMLButtonElement>&{children:ReactNode}){return <button className={`btn ${className}`} {...p}>{children}</button>}
export function Field({label,children,hint}:{label:string,children:ReactNode,hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
export function Stat({label,value,sub}:{label:string,value:string,sub?:string}){return <div className="stat"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}
export function MiniStat({label,value}:{label:string,value:string}){return <div className="mini-stat"><span>{label}</span><b>{value}</b></div>}
export function Check({ok,text}:{ok:boolean,text:string}){return <div className={`check ${ok?'ok':'bad'}`}><i>{ok?'✓':'!'}</i><span>{text}</span></div>}
export function Spinner(){return <span className="spinner"/>}
