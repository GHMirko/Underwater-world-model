
/** Operator console. Reparent existing control panels without cloning any ID. */
const GROUPS = [
  {id:'chart',name:'Carta',subtitle:'Terra e batimetria',symbol:'◫',panels:['landMapPanel','seaMapPanel']},
  {id:'mission',name:'Missione',subtitle:'Area operativa e task',symbol:'⌖',panels:['missionPanel']},
  {id:'data',name:'Dati',subtitle:'Fonti e World Model',symbol:'▤',panels:['bathyBrokerPanel','environmentPanel']},
  {id:'acoustic',name:'Acustica',subtitle:'Ambiente e Bellhop3D',symbol:'◉',panels:['acousticEnvironmentPanel']},
  {id:'assets',name:'Assetti',subtitle:'Assetti e ottimizzazione',symbol:'⤨',panels:['assetsPanel','optimizerPanel']}
];
export function operatorSections() { return GROUPS.map(x=>({...x,panels:[...x.panels]})); }
function el(tag,cl,txt) { const n=document.createElement(tag); if(cl)n.className=cl; if(txt)n.textContent=txt; return n; }

export function createOperatorWorkspace({root,map,state,subscribeState}) {
  const workspace=root.querySelector('.workspace'),drawer=root.querySelector('.sidebar');
  const header=root.querySelector('.header');
  if(!workspace||!drawer||!header)throw Error('Operator UI containers missing');
  workspace.classList.add('operator-workspace');
  drawer.id='operatorDrawer'; drawer.classList.add('operator-drawer');
  drawer.setAttribute('aria-label','Comandi operativi contestuali');
  const rail=el('nav','operator-rail'); rail.id='operatorRail';
  rail.setAttribute('aria-label','Funzioni operative');
  rail.append(el('div','operator-rail-brand','UW'));
  const tabs=new Map(),sections=new Map();
  const head=el('div','operator-drawer-heading');
  const titleWrap=el('div','operator-heading-copy');
  titleWrap.append(el('span','operator-kicker','CONTROLLO OPERATIVO'));
  const title=el('h2','operator-drawer-title','Funzione');
  const subtitle=el('span','operator-drawer-subtitle','');
  titleWrap.append(title,subtitle);
  const closeButton=el('button','operator-close','×');
  closeButton.type='button';closeButton.id='operatorClose';
  closeButton.setAttribute('aria-label','Chiudi pannello');
  head.append(titleWrap,closeButton);drawer.prepend(head);
  for(const group of GROUPS) {
    const section=el('section','operator-section');
    section.id='operatorPanel-'+group.id;
    section.setAttribute('aria-labelledby','operatorTab-'+group.id);
    section.hidden=true;
    section.tabIndex=-1;
    for(const id of group.panels){
      const p=root.querySelector('#'+id);
      if(!p)throw Error('Missing operator control panel: '+id);
      section.append(p);
    }
    drawer.append(section);sections.set(group.id,section);
    const b=el('button','operator-rail-button');
    b.type='button';b.id='operatorTab-'+group.id;
    b.dataset.section=group.id;
    b.title=group.name+' · '+group.subtitle;
    b.setAttribute('aria-controls',section.id);
    b.setAttribute('aria-expanded','false');
    const icon=el('span','operator-rail-icon',group.symbol);
    icon.setAttribute('aria-hidden','true');
    b.append(icon,el('span','operator-rail-label',group.name));
    rail.append(b);tabs.set(group.id,b);
  }
  rail.append(el('div','operator-rail-foot','CONSOLE'));
  workspace.prepend(rail);

  const quick=el('div','operator-quick-actions');
  quick.setAttribute('role','group');quick.setAttribute('aria-label','Azioni rapide AOI');
  const buttons=[
    ['quickDrawAoi','＋ Disegna AOI','drawAoi'],
    ['quickFitAoi','⌖ Centra AOI','fitAoi'],
    ['quickClearAoi','× Cancella','clearAoi']
  ];
  for(const [id,label,target] of buttons) {
    const b=el('button','operator-action'+(id==='quickDrawAoi'?' primary':''),label);
    b.id=id;b.type='button';
    b.disabled=id!=='quickDrawAoi';
    b.addEventListener('click',()=>{
      root.querySelector('#'+target)?.click();
      if(id==='quickDrawAoi')b.setAttribute('aria-pressed','true');
    });
    quick.append(b);
  }
  header.append(quick);
  map.on('mouseup',()=>root.querySelector('#quickDrawAoi')?.setAttribute('aria-pressed','false'));

  const status=el('div','operator-statusbar');
  status.id='operatorStatusBar';
  status.setAttribute('aria-label','Stato sistemi');
  for(const [id,tag] of [['operatorAoiState','AOI'],['operatorBathyState','BATIMETRIA'],['operatorDataState','WORLD MODEL'],['operatorAcousticState','BELLHOP3D']]) {
    const item=el('div','operator-status-item');
    item.append(el('span','operator-status-tag',tag));
    const val=el('strong','operator-status-value','IN ATTESA');val.id=id;item.append(val);
    status.append(item);
  }
  workspace.append(status);

  let active=null;
  function open(id,{focus=false}={}){
    if(id!==null&&!sections.has(id))return;
    active=id===active?null:id;
    drawer.hidden=!active;
    for(const group of GROUPS) {
      const on=group.id===active;
      sections.get(group.id).hidden=!on;
      tabs.get(group.id).classList.toggle('active',on);
      tabs.get(group.id).setAttribute('aria-expanded',String(on));
      tabs.get(group.id).setAttribute('aria-pressed',String(on));
      if(on){title.textContent=group.name;subtitle.textContent=group.subtitle;}
    }
    if(active&&focus)sections.get(active).focus({preventScroll:true});
  }
  for(const group of GROUPS)tabs.get(group.id).addEventListener('click',()=>open(group.id));
  function close() {
    const previous=active;
    if(active)open(active);
    if(previous)tabs.get(previous).focus({preventScroll:true});
  }
  closeButton.addEventListener('click',close);

  function sync(){
    const aoi=Boolean(state.aoi);
    root.querySelector('#quickFitAoi').disabled=!aoi;
    root.querySelector('#quickClearAoi').disabled=!aoi;
    if(!aoi)root.querySelector('#quickDrawAoi').setAttribute('aria-pressed','false');
    root.querySelector('#operatorAoiState').textContent=aoi?'DEFINITA':'NON DEFINITA';
    root.querySelector('#operatorBathyState').textContent=state.bathyMode==='none'?'OFF':
      state.bathymetryGridSource?'GRID '+state.bathymetryGridSource:'SOLO CONTESTO';
    root.querySelector('#operatorDataState').textContent='QA DA COMPLETARE';
    root.querySelector('#operatorAcousticState').textContent='TL NON CALCOLATA';
  }
  sync();
  const unsubscribe=subscribeState(sync);
  const onKey=event=>{
    if(event.key==='Escape'&&active){close();event.preventDefault();return;}
    if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const number=Number(event.key);
    if(Number.isInteger(number)&&number>=1&&number<=GROUPS.length){
      event.preventDefault();open(GROUPS[number-1].id,{focus:true});
    }
  };
  document.addEventListener('keydown',onKey);
  drawer.hidden=true;
  return {
    open(id){if(active!==id)open(id);},
    close,getActiveSection(){return active;},syncStatus:sync,
    destroy(){unsubscribe();document.removeEventListener('keydown',onKey);}
  };
}
