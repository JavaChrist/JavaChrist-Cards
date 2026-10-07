import React,{useState,useEffect,useRef,useId} from 'react';
import {createRoot} from 'react-dom/client';
import {supabase,publicOrigin,resolveImages} from './client';
import {emptyProfile,safeLink,telephone,emailLink,cardUrl,qrSvg,qrPngBlob,shareLink,preferredInstallTab,vcard,saveFile,validateProfile,normalizeProfile} from './lib';
import './style.css';

const PUBLIC_FIELDS='id,title,profile,avatar_path,logo_path,published';
const installPrompt={current:null};
if(typeof window!=='undefined'){
  window.addEventListener('beforeinstallprompt',(event)=>{
    if(!/^\/c\/[0-9a-f-]{36}\/?$/i.test(location.pathname))return;
    event.preventDefault();
    installPrompt.current=event;
    window.dispatchEvent(new Event('card-install-available'));
  });
}

function Icon({name}){const paths={qr:'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6z',contact:'M5 3h14v18H5zM9 9a3 3 0 1 0 6 0 3 3 0 1 0-6 0M8 18c0-5 8-5 8 0',phone:'M5 3 3 5c0 8 8 16 16 16l2-2-5-4-2 2c-3-1-6-4-7-7l2-2z',mail:'M3 5h18v14H3zM3 5l9 8 9-8',pin:'M12 22s8-7 8-12a8 8 0 0 0-16 0c0 5 8 12 8 12M9 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0',share:'M12 16V3M8 7l4-4 4 4M5 13v8h14v-8',plus:'M12 4v16M4 12h16',close:'M6 6l12 12M6 18 18 6',external:'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7'};return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={paths[name]||paths.external}/></svg>}
function holderName(profile,fallback='Cette carte'){return [profile?.firstName,profile?.lastName].filter(Boolean).join(' ')||fallback}

function Modal({title,onClose,children,focusSelector='.close'}){
  const ref=useRef(null);
  const restore=useRef(null);
  const closeRef=useRef(onClose);
  const titleId=useId();
  closeRef.current=onClose;
  useEffect(()=>{
    restore.current=document.activeElement;
    const dialog=ref.current;
    let closed=false;
    const requestClose=(event)=>{
      if(event)event.preventDefault();
      if(closed)return;
      closed=true;
      closeRef.current();
    };
    const onKey=(event)=>{if(event.key==='Escape')requestClose(event);};
    dialog.addEventListener('cancel',requestClose);
    dialog.addEventListener('keydown',onKey);
    if(!dialog.open)dialog.showModal();
    dialog.querySelector(focusSelector)?.focus();
    return()=>{
      dialog.removeEventListener('cancel',requestClose);
      dialog.removeEventListener('keydown',onKey);
      if(dialog.open)dialog.close();
      const back=restore.current;
      if(back instanceof HTMLElement&&document.contains(back))back.focus();
    };
  },[focusSelector]);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId}><div className="modal-chrome"><button type="button" className="close" onClick={onClose} aria-label="Fermer"><Icon name="close"/></button></div><div className="modal-body"><h2 id={titleId}>{title}</h2>{children}</div></dialog>;
}

function useConfirm(){
  const askRef=useRef(null);
  const [ask,setAsk]=useState(null);
  function confirm(options){
    return new Promise((resolve)=>{
      const next={title:options.title,body:options.body||'',confirmLabel:options.confirmLabel||'Confirmer',resolve};
      askRef.current=next;
      setAsk(next);
    });
  }
  function finish(value){
    const current=askRef.current;
    askRef.current=null;
    setAsk(null);
    current?.resolve(value);
  }
  const dialog=ask?<Modal title={ask.title} onClose={()=>finish(false)} focusSelector=".modal-cancel">{ask.body&&<p>{ask.body}</p>}<div className="modal-actions"><button type="button" className="button secondary modal-cancel" onClick={()=>finish(false)}>Annuler</button><button type="button" className="button primary" onClick={()=>finish(true)}>{ask.confirmLabel}</button></div></Modal>:null;
  return {confirm,dialog};
}

function ErrorText({children}){return children?<p className="error" role="alert">{children}</p>:null}
function Feedback({feedback}){if(!feedback)return null;return <p className={feedback.error?'error':'notice'} role={feedback.error?'alert':'status'}>{feedback.text}</p>}

function QrModal({id,name,onClose}){
  const url=cardUrl(id,publicOrigin);
  const svg=qrSvg(url,`QR code vers la carte de ${name}`);
  const [feedback,setFeedback]=useState(null);
  async function copy(){
    try{await navigator.clipboard.writeText(url);setFeedback({error:false,text:'Lien copié.'})}
    catch{setFeedback({error:true,text:'Impossible de copier le lien. Sélectionnez l’adresse ci-dessous.'})}
  }
  async function downloadPng(){
    try{saveFile(await qrPngBlob(url),'carte-qr.png','image/png');setFeedback(null)}
    catch{setFeedback({error:true,text:'Le téléchargement PNG a échoué.'})}
  }
  return <Modal title="Scannez. Enregistrez." onClose={onClose}><p className="holder-name">{name}</p><div className="qr-frame" dangerouslySetInnerHTML={{__html:svg}}/><Feedback feedback={feedback}/><input className="copy-url" aria-label="Lien public de la carte" readOnly value={url} onFocus={(event)=>event.target.select()}/><div className="modal-actions"><button type="button" className="button primary" onClick={copy}>Copier le lien</button><button type="button" className="button secondary" onClick={downloadPng}>Télécharger le QR code en PNG</button><button type="button" className="button secondary" onClick={()=>saveFile(svg,'carte-qr.svg','image/svg+xml')}>Télécharger le QR code en SVG</button></div></Modal>;
}

const INSTALL_TABS=[
  {id:'ios',label:'iPhone / iPad'},
  {id:'android',label:'Android'},
  {id:'desktop',label:'Ordinateur'},
];

function InstallModal({onClose}){
  const [tab,setTab]=useState(()=>preferredInstallTab(navigator.userAgent,{platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints}));
  const [canInstall,setCanInstall]=useState(()=>!!installPrompt.current);
  const [installStatus,setInstallStatus]=useState('');
  const tabsRef=useRef(null);
  useEffect(()=>{
    const sync=()=>setCanInstall(!!installPrompt.current);
    window.addEventListener('card-install-available',sync);
    return()=>window.removeEventListener('card-install-available',sync);
  },[]);
  function onTabKey(event){
    const index=INSTALL_TABS.findIndex((item)=>item.id===tab);
    if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
    event.preventDefault();
    const next=INSTALL_TABS[(index+(event.key==='ArrowRight'?1:INSTALL_TABS.length-1))%INSTALL_TABS.length];
    setTab(next.id);
    tabsRef.current?.querySelector(`[data-tab="${next.id}"]`)?.focus();
  }
  async function installNative(){
    const event=installPrompt.current;
    if(!event)return;
    installPrompt.current=null;
    setCanInstall(false);
    try{
      await event.prompt();
      const choice=await event.userChoice;
      if(choice?.outcome==='accepted')setInstallStatus('Le navigateur a lancé l’installation.');
    }catch(error){
      if(error?.name!=='AbortError')setInstallStatus('L’installation native n’a pas démarré. Suivez les étapes ci-dessous.');
    }
  }
  return <Modal title="Votre carte en un geste." onClose={onClose}>
    {canInstall&&<button type="button" className="button primary" onClick={installNative}>Installer cette carte</button>}
    {installStatus&&<p className="notice" role="status">{installStatus}</p>}
    <div className="install-tabs" role="tablist" aria-label="Instructions d’installation" ref={tabsRef} onKeyDown={onTabKey}>
      {INSTALL_TABS.map((item)=><button type="button" key={item.id} data-tab={item.id} role="tab" id={'install-tab-'+item.id} aria-selected={tab===item.id} aria-controls={'install-panel-'+item.id} tabIndex={tab===item.id?0:-1} onClick={()=>setTab(item.id)}>{item.label}</button>)}
    </div>
    {tab==='ios'&&<div role="tabpanel" id="install-panel-ios" aria-labelledby="install-tab-ios"><ol className="install-steps"><li>Ouvrez cette carte dans Safari.</li><li>Touchez le bouton Partager.</li><li>Choisissez « Sur l’écran d’accueil ».</li><li>Confirmez avec « Ajouter ».</li><li>Si l’option n’est pas visible, faites défiler les actions du menu de partage.</li></ol></div>}
    {tab==='android'&&<div role="tabpanel" id="install-panel-android" aria-labelledby="install-tab-android"><ol className="install-steps"><li>Ouvrez cette carte dans Chrome.</li><li>Ouvrez le menu ⋮.</li><li>Choisissez « Ajouter à l’écran d’accueil » ou « Installer l’application », selon ce que propose le navigateur.</li><li>Confirmez.</li></ol></div>}
    {tab==='desktop'&&<div role="tabpanel" id="install-panel-desktop" aria-labelledby="install-tab-desktop"><p className="install-note">Ouvrez cette carte sur votre téléphone. Affichez « Mon QR code » : il mène à cette carte précise. Scannez-le, puis suivez les étapes iPhone / iPad ou Android. Le raccourci rouvrira cette carte.</p></div>}
    <button type="button" className="button primary" onClick={onClose}>C’est compris</button>
  </Modal>;
}

function Card({card,preview=false}){
  const p=normalizeProfile(card.profile);
  const [qr,setQr]=useState(false);
  const [message,setMessage]=useState(null);
  const url=cardUrl(card.id,publicOrigin);
  const accent=/^#[0-9a-f]{6}$/i.test(p.accent)?p.accent:'#ff941f';
  const name=holderName(p,'Votre nom');
  async function share(){
    const result=await shareLink(url,name);
    if(result==='copied')setMessage({error:false,text:'Lien copié.'});
    else if(result==='copy-failed')setMessage({error:true,text:'Impossible de partager ou de copier le lien. Ouvrez le QR code pour le sélectionner.'});
    else setMessage(null);
  }
  return <div className={'card-surface '+(preview?'compact':'')} style={{'--accent':accent}}><article className="business-card"><div className="portrait-panel">{card.avatarUrl?<img className="portrait" src={card.avatarUrl} alt={'Portrait de '+name}/>:<div className="initials">{(p.firstName[0]||'V')+(p.lastName[0]||'N')}</div>}<div className="portrait-caption"><div className="portrait-text"><span>{p.company||'Votre entreprise'}</span>{p.slogan&&<small>{p.slogan}</small>}</div>{card.logoUrl&&<img src={card.logoUrl} alt={'Logo '+p.company}/>}</div></div><div className="card-content"><p className="eyebrow">{p.role||'Votre activité'}{p.company?' · '+p.company:''}</p><h1>{p.firstName||'Votre'} <span>{p.lastName||'nom'}</span></h1>{p.tagline&&<p className="intro">{p.tagline}</p>}<button className="button primary" disabled={preview} onClick={()=>saveFile(vcard(p,url),'contact.vcf','text/vcard;charset=utf-8')}><Icon name="contact"/>Enregistrer mon contact</button><div className="contact-list">{p.phone&&<a href={preview?undefined:'tel:'+telephone(p.phone)} className="contact-row"><Icon name="phone"/><span><small>Téléphone</small>{p.phone}</span></a>}{p.email&&<a href={preview?undefined:emailLink(p.email)} className="contact-row"><Icon name="mail"/><span><small>E-mail</small>{p.email}</span></a>}{(p.street||p.city)&&<div className="contact-row"><Icon name="pin"/><span><small>Adresse</small>{p.street}<br/>{[p.postal,p.city].filter(Boolean).join(' ')}{p.country&&p.country!=='France'?<><br/>{p.country}</>:null}</span></div>}</div><div className="socials">{[['website','Site web'],['linkedin','LinkedIn'],['github','GitHub']].map(([key,label])=>safeLink(p[key])&&<a key={key} href={preview?undefined:safeLink(p[key])} target="_blank" rel="noopener noreferrer">{label}<Icon name="external"/></a>)}</div></div></article>{!preview&&<div className="sharebar"><div><strong>Gardons le contact.</strong><p>Une rencontre. De nouvelles idées.</p></div><div className="actions"><button type="button" className="button secondary qr-launch" onClick={()=>setQr(true)}><Icon name="qr"/>Mon QR code</button><button type="button" className="button secondary icon-button" onClick={share} aria-label="Partager la carte"><Icon name="share"/></button></div></div>}{!preview&&<Feedback feedback={message}/>}{qr&&<QrModal id={card.id} name={name} onClose={()=>setQr(false)}/>}</div>;
}

function Auth({recovery=false}){const [mode,setMode]=useState('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
async function submit(e){e.preventDefault();setError('');setNotice('');setBusy(true);try{let result;if(recovery){result=await supabase.auth.updateUser({password});if(result.error)throw result.error;location.assign('/app');return;}if(mode==='signup'){result=await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/app'}});if(result.error)throw result.error;if(result.data.session)location.assign('/app');else setNotice('Consultez votre boîte mail pour confirmer votre inscription.');}else if(mode==='reset'){result=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/reset-password'});if(result.error)throw result.error;setNotice('Si un compte correspond à cette adresse, un lien de réinitialisation vous sera envoyé.');}else{result=await supabase.auth.signInWithPassword({email,password});if(result.error)throw result.error;location.assign('/app');}}catch(e){setError(e.message||'Connexion impossible. Réessayez.')}finally{setBusy(false)}}
return <section className="auth-panel"><p className="eyebrow">VOTRE CARTE. VOTRE IDENTITÉ.</p><h1>{recovery?'Nouveau mot de passe':mode==='signup'?'Créons votre compte.':mode==='reset'?'Mot de passe oublié ?':'Heureux de vous revoir.'}</h1><p className="muted">Vos cartes restent à jour. Vos contacts restent connectés.</p><form onSubmit={submit}>{!recovery&&<label>E-mail<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>}{(recovery||mode!=='reset')&&<label>Mot de passe<input type="password" required minLength={mode==='signup'||recovery?12:1} autoComplete={mode==='signup'||recovery?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/>{(mode==='signup'||recovery)&&<small>12 caractères minimum.</small>}</label>}<ErrorText>{error}</ErrorText>{notice&&<p className="notice" role="status">{notice}</p>}<button disabled={busy} className="button primary">{busy?'Un instant…':recovery?'Enregistrer':mode==='signup'?'Créer mon compte':mode==='reset'?'Envoyer le lien':'Me connecter'}</button></form>{!recovery&&<div className="auth-links"><button type="button" onClick={()=>{setMode(mode==='signup'?'login':'signup');setError('');setNotice('')}}>{mode==='signup'?'J’ai déjà un compte':'Créer un compte'}</button><button type="button" onClick={()=>{setMode(mode==='reset'?'login':'reset');setError('');setNotice('')}}>{mode==='reset'?'Retour à la connexion':'Mot de passe oublié'}</button></div>}</section>}

const fields=[['firstName','Prénom'],['lastName','Nom'],['company','Entreprise'],['role','Fonction'],['phone','Téléphone','tel'],['email','E-mail public','email'],['street','Adresse'],['postal','Code postal'],['city','Ville'],['country','Pays'],['website','Site web','url'],['linkedin','LinkedIn','url'],['github','GitHub','url']];
function Editor({initial,user,onClose,onSaved}){
  const [card,setCard]=useState(initial),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[notice,setNotice]=useState('');
  const importRef=useRef();
  const {confirm,dialog}=useConfirm();
  const p=card.profile;
  useEffect(()=>{const guard=e=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)},[dirty]);
  function change(key,value){setCard(c=>({...c,profile:{...c.profile,[key]:value}}));setDirty(true)}
  async function upload(kind,file){if(!file)return;setError('');if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('Choisissez une image JPG, PNG ou WebP de moins de 5 Mo.');return}setBusy(true);const path=user.id+'/'+card.id+'/'+kind+'-'+crypto.randomUUID()+'.'+({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type]);try{const {error}=await supabase.storage.from('card-images').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;const {data,error:signError}=await supabase.storage.from('card-images').createSignedUrl(path,120);if(signError)throw signError;setCard(c=>({...c,[kind+'_path']:path,[kind+'Url']:data.signedUrl}));setDirty(true);setNotice('Image ajoutée. Enregistrez la carte pour appliquer ce changement.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function save(e){e.preventDefault();const invalid=validateProfile(p);if(invalid){setError(invalid);return}setBusy(true);setError('');try{const payload={title:card.title,profile:p,published:card.published,avatar_path:card.avatar_path||null,logo_path:card.logo_path||null};const {data,error}=await supabase.from('cards').update(payload).eq('id',card.id).eq('owner_id',user.id).select().single();if(error)throw error;setDirty(false);setNotice('Carte enregistrée.');onSaved(data)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function importProfile(file){if(!file)return;try{if(file.size>20000)throw Error('Fichier trop volumineux.');const data=JSON.parse(await file.text());const profile={...emptyProfile};for(const key of Object.keys(profile))if(typeof data[key]==='string')profile[key]=data[key].slice(0,1000);setCard(c=>({...c,profile}));setDirty(true);setNotice('Coordonnées importées. Ajoutez vos images puis enregistrez.')}catch{setError('Import impossible : utilisez un fichier JSON de coordonnées valide.')}}
  async function leave(){if(!dirty||await confirm({title:'Quitter sans enregistrer les modifications ?',confirmLabel:'Quitter'}))onClose()}
  return <><div className="page-heading"><div><p className="eyebrow">ATELIER DE CRÉATION</p><h1>Votre carte, à votre image.</h1></div><button type="button" className="button secondary" onClick={leave}>Mes cartes</button></div><div className="editor-layout"><form className="editor-form" onSubmit={save}><fieldset disabled={busy}><section className="panel"><h2>Identité</h2><label>Nom de la carte <small>Visible dans votre espace</small><input required maxLength={100} value={card.title} onChange={e=>{setCard({...card,title:e.target.value});setDirty(true)}}/></label><div className="form-grid">{fields.map(([key,label,type])=><label key={key}>{label}<input type={type||'text'} required={['firstName','lastName'].includes(key)} maxLength={key==='street'?250:200} value={p[key]} onChange={e=>change(key,e.target.value)} placeholder={type==='url'?'https://':''}/></label>)}</div><label>Signature sur la photo <small>Sous le nom, sur l’image</small><input maxLength={120} value={p.slogan} onChange={e=>change('slogan',e.target.value)} placeholder="LE NUMÉRIQUE, À VOTRE IMAGE."/></label><label>Présentation<textarea maxLength={500} rows={3} value={p.tagline} onChange={e=>change('tagline',e.target.value)}/></label><div className="actions"><button type="button" className="text-button" onClick={()=>importRef.current.click()}>Importer mes coordonnées</button><button type="button" className="text-button" onClick={()=>saveFile(JSON.stringify(p,null,2),'coordonnees.json','application/json')}>Exporter</button></div><input ref={importRef} type="file" hidden accept="application/json,.json" onChange={e=>{importProfile(e.target.files[0]);e.target.value=''}}/></section><section className="panel"><h2>Apparence</h2><div className="form-grid">{['avatar','logo'].map(kind=><label key={kind}>{kind==='avatar'?'Photo ou avatar':'Logo'}<input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={e=>{upload(kind,e.target.files[0]);e.target.value=''}}/>{card[kind+'_path']&&<button type="button" className="text-button" onClick={()=>{setCard({...card,[kind+'_path']:null,[kind+'Url']:null});setDirty(true)}}>Retirer l’image</button>}</label>)}</div><p className="muted small">JPG, PNG ou WebP · 5 Mo maximum par image.</p><label>Couleur d’accent<input type="color" value={p.accent} onChange={e=>change('accent',e.target.value)}/></label></section><section className="panel"><h2>Publication</h2><label className="check"><input type="checkbox" checked={card.published} onChange={e=>{setCard({...card,published:e.target.checked});setDirty(true)}}/><span>Rendre ma carte publique</span></label><p className="muted small">Une carte publique et ses coordonnées sont accessibles à toute personne disposant du lien. Décochez puis enregistrez pour retirer l’accès.</p><ErrorText>{error}</ErrorText>{notice&&<p role="status" className="notice">{notice}</p>}<button className="button primary" disabled={busy}>{busy?'En cours…':'Enregistrer ma carte'}</button></section></fieldset></form><aside className="preview"><p className="eyebrow">APERÇU MOBILE</p><Card card={card} preview/><p className="muted small">L’aperçu reflète vos changements avant enregistrement.</p></aside></div>{dialog}</>;
}

function Dashboard({user}){
  const [cards,setCards]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[qr,setQr]=useState(null),[shareNote,setShareNote]=useState(null);
  const {confirm,dialog}=useConfirm();
  async function load(){setLoading(true);setError('');const {data,error}=await supabase.from('cards').select('*').eq('owner_id',user.id).order('created_at',{ascending:false});if(error)setError(error.message);else setCards(data.map(c=>({...c,profile:normalizeProfile(c.profile)})));setLoading(false)}
  useEffect(()=>{load()},[user.id]);
  async function create(){setBusy(true);setError('');const {data,error}=await supabase.from('cards').insert({owner_id:user.id,title:'Ma nouvelle carte',profile:emptyProfile}).select().single();if(error)setError(error.message);else setEditing(data);setBusy(false)}
  async function edit(c){setBusy(true);try{setEditing(await resolveImages(c))}catch{setError('Impossible de charger cette carte.')}finally{setBusy(false)}}
  async function remove(c){
    const accepted=await confirm({title:'Supprimer « '+c.title+' » ?',body:'Son lien et son QR code ne fonctionneront plus.',confirmLabel:'Supprimer'});
    if(!accepted)return;
    setBusy(true);
    const {error}=await supabase.from('cards').delete().eq('id',c.id).eq('owner_id',user.id);
    if(error){setError(error.message);setBusy(false);return}
    const prefix=user.id+'/'+c.id;
    const {data:files,error:listError}=await supabase.storage.from('card-images').list(prefix,{limit:1000});
    let cleanupError=listError;
    if(files?.length){const result=await supabase.storage.from('card-images').remove(files.map(f=>prefix+'/'+f.name));cleanupError=result.error}
    await load();
    if(cleanupError)setError('Carte supprimée, mais certaines images n’ont pas pu être nettoyées.');
    setBusy(false);
  }
  async function shareCard(c){
    const url=cardUrl(c.id,publicOrigin);
    const result=await shareLink(url,holderName(c.profile,c.title));
    if(result==='copied')setShareNote({error:false,text:'Lien copié.'});
    else if(result==='copy-failed')setShareNote({error:true,text:'Impossible de partager ou de copier le lien. Ouvrez le QR code pour le sélectionner.'});
    else setShareNote(null);
  }
  if(editing)return <Editor key={editing.id} initial={{...editing,profile:normalizeProfile(editing.profile)}} user={user} onClose={()=>{setEditing(null);load()}} onSaved={data=>{setCards(cs=>cs.map(c=>c.id===data.id?data:c))}}/>;
  return <><div className="page-heading"><div><p className="eyebrow">VOTRE ESPACE</p><h1>Mes cartes.</h1><p className="muted">Une identité pour chaque activité. Un lien pour chaque rencontre.</p></div><button className="button primary fit" onClick={create} disabled={busy}><Icon name="plus"/>Créer une carte</button></div><ErrorText>{error}</ErrorText><Feedback feedback={shareNote}/>{loading?<p role="status">Chargement de vos cartes…</p>:cards.length===0?<section className="empty panel"><Icon name="contact"/><h2>Tout commence par une rencontre.</h2><p className="muted">Créez votre première carte et partagez vos coordonnées en un scan.</p><button className="button primary fit" onClick={create} disabled={busy}>Créer ma première carte</button></section>:<div className="card-grid">{cards.map(c=>{const name=holderName(c.profile,'Coordonnées à compléter');return <article className="card-tile" key={c.id}><span className={'status '+(c.published?'live':'')}>{c.published?'Publique':'Brouillon'}</span><h2>{c.title}</h2><p>{name}</p><p className="muted">{c.profile.company||'Votre activité'}</p><div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>edit(c)}>Modifier</button>{c.published&&<><a className="button secondary" href={'/c/'+c.id} target="_blank" rel="noopener noreferrer">Voir</a><button type="button" className="button secondary" onClick={()=>setQr(c)} aria-label={'Mon QR code de '+c.title}><Icon name="qr"/>QR code</button><button type="button" className="button secondary icon-button" onClick={()=>shareCard(c)} aria-label={'Partager '+c.title}><Icon name="share"/></button></>}</div>{!c.published&&<p className="draft-share">Publiez la carte avant de la partager.</p>}<button type="button" className="text-button danger" disabled={busy} onClick={()=>remove(c)}>Supprimer</button></article>})}</div>}{qr&&<QrModal id={qr.id} name={holderName(qr.profile,qr.title)} onClose={()=>setQr(null)}/>}{dialog}</>;
}

function PublicCard({id}){
  const [card,setCard]=useState(null),[state,setState]=useState('loading'),[install,setInstall]=useState(false);
  useEffect(()=>{
    let live=true;
    async function read(){
      const {data,error}=await supabase.from('cards').select(PUBLIC_FIELDS).eq('id',id).eq('published',true).maybeSingle();
      if(!live)return;
      if(error){setState('error');return}
      if(!data){setState('missing');return}
      const c=await resolveImages({...data,profile:normalizeProfile(data.profile)});
      if(live){setCard(c);setState('ready');document.title=holderName(c.profile,'Carte de contact')+' · Carte de contact'}
    }
    read();
    return()=>{live=false};
  },[id]);
  useEffect(()=>{
    const meta=document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if(!meta||state!=='ready'||!card)return;
    const previous=meta.content;
    meta.content=holderName(card.profile,'JavaChrist Cards');
    return()=>{meta.content=previous};
  },[card,state]);
  if(state==='loading')return <p role="status">Chargement de la carte…</p>;
  if(state!=='ready')return <section className="empty panel"><h1>{state==='missing'?'Cette carte n’est pas disponible.':'Connexion impossible.'}</h1><p className="muted">{state==='missing'?'Elle est privée, a été supprimée ou le lien est incorrect.':'Vérifiez votre connexion et réessayez.'}</p>{state==='error'&&<button className="button secondary" onClick={()=>location.reload()}>Réessayer</button>}</section>;
  return <div className="public-wrap"><Card card={card}/><footer><span>JavaChrist © {new Date().getFullYear()}</span><button type="button" className="text-button home-screen" onClick={()=>setInstall(true)}>Ajouter à l’écran d’accueil</button></footer>{install&&<InstallModal onClose={()=>setInstall(false)}/>}</div>;
}

function Setup(){return <section className="panel auth-panel"><p className="eyebrow">INSTALLATION</p><h1>JavaChrist Cards est prêt à être connecté.</h1><p>Configurez Supabase et les deux variables indiquées dans le fichier README du projet, puis relancez le déploiement.</p><p className="muted">Les comptes et les cartes seront enregistrés dans votre propre projet Supabase.</p></section>}
function App(){
  const [user,setUser]=useState(null),[ready,setReady]=useState(false),[error,setError]=useState('');
  const path=location.pathname;
  const publicId=/^\/c\/([0-9a-f-]{36})\/?$/i.exec(path)?.[1];
  useEffect(()=>{
    if(!supabase){setReady(true);return}
    supabase.auth.getSession().then(({data,error})=>{if(error)setError(error.message);setUser(data.session?.user||null);setReady(true)});
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{setUser(session?.user||null);setReady(true)});
    return()=>data.subscription.unsubscribe();
  },[]);
  return <div className={'shell'+(publicId?' public-shell':'')}><header className="topbar"><a className="brand" href={user?'/app':'/'}><img src="/assets/logo.png" alt=""/>{publicId?'JavaChrist.':<>JavaChrist <span>Cards.</span></>}</a>{publicId?<p className="card-kicker">Carte de contact</p>:user&&<button type="button" className="text-button" onClick={async()=>{const {error}=await supabase.auth.signOut();if(error)setError(error.message);else location.assign('/auth')}}>Déconnexion</button>}</header><main><ErrorText>{error}</ErrorText>{!supabase?<Setup/>:publicId?<PublicCard id={publicId}/>:path.startsWith('/c/')?<section className="panel"><h1>Lien de carte invalide.</h1></section>:!ready?<p role="status">Chargement…</p>:path==='/reset-password'?<Auth recovery/>:user?<Dashboard user={user}/>:<Auth/>}</main>{!publicId&&<footer><span>JavaChrist Cards</span><span>Votre identité, en un scan.</span></footer>}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
