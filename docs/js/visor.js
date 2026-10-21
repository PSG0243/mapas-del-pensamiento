"use strict";

/** Descarga y deserializa un archivo JSON del mismo sitio. */
async function cargarJSON(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar ${ruta}: HTTP ${respuesta.status}`);
  }
  try {
    return await respuesta.json();
  } catch (error) {
    throw new Error(`El archivo ${ruta} no contiene JSON válido.`);
  }
}

/** Comprueba la estructura mínima que utiliza el visor. */
function validarDatos(repertorios, baseClara) {
  if (!Array.isArray(repertorios) || repertorios.length === 0) {
    throw new Error("El archivo de repertorios no contiene una lista de autores.");
  }
  const autores = new Set();
  const registros = new Set();
  for (const autor of repertorios) {
    if (!autor.id || !autor.autor || !Array.isArray(autor.features) || autor.features.length === 0) {
      throw new Error("Se ha encontrado un repertorio incompleto.");
    }
    if (autores.has(autor.id)) {
      throw new Error(`Identificador de autor duplicado: ${autor.id}`);
    }
    autores.add(autor.id);
    for (const registro of autor.features) {
      if (!registro.id || registros.has(registro.id)) {
        throw new Error("Identificador de registro ausente o duplicado.");
      }
      registros.add(registro.id);
      const coordenadas = registro.xy;
      if (!Array.isArray(coordenadas) || coordenadas.length !== 2 ||
          !coordenadas.every(Number.isFinite) ||
          Math.abs(coordenadas[0]) > 180 || Math.abs(coordenadas[1]) > 90 ||
          !registro.labels || !registro.phil || !registro.cart) {
        throw new Error(`Registro incompleto o coordenadas no válidas: ${registro.id}`);
      }
    }
  }
  if (!baseClara || baseClara.type !== "Feature" || !baseClara.geometry ||
      !["Polygon", "MultiPolygon"].includes(baseClara.geometry.type)) {
    throw new Error("La base clara no contiene la geometría GeoJSON esperada.");
  }
}

/** Inicializa únicamente después de que estén disponibles ambos archivos. */
async function iniciarVisor() {
  const aviso = document.getElementById("loadNotice");
  const controles = [...document.querySelectorAll("input, select, button")];
  const estadosPrevios = controles.map(elemento => elemento.disabled);
  controles.forEach(elemento => { elemento.disabled = true; });

  try {
    const [DATA, LAND] = await Promise.all([
      cargarJSON("./data/repertorios.json"),
      cargarJSON("./data/base-clara.geojson")
    ]);
    validarDatos(DATA, LAND);
    controles.forEach((elemento, i) => { elemento.disabled = estadosPrevios[i]; });

    // Código original: conserva funciones, criterios y operaciones del visor.
    const $=id=>document.getElementById(id);
    const sinCursivas = s => String(s ?? '').replace(/<\/?i>/g, '');
    const norm = s => sinCursivas(s)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }
    [c]));
    let map=null,points=null,names=null,geo=null,tiles=null,heat=null,heatOn=false,selectedId=null,hits=[],labelObjects=[],citationFormat='APA',statusText='',tileFailed=false;
    let PaneSafeHeat=null;
    if(window.L&&L.HeatLayer){
      PaneSafeHeat=L.HeatLayer.extend({
        onAdd:function(m){
          L.HeatLayer.prototype.onAdd.call(this,m);if(this._canvas)m.getPane('heat').appendChild(this._canvas)
        },onRemove:function(m){
          if(this._canvas&&this._canvas.parentNode!==m.getPanes().overlayPane)m.getPanes().overlayPane.appendChild(this._canvas);L.HeatLayer.prototype.onRemove.call(this,m)
        }
      })
    }
    function removeHeat(){
      if(map&&heat){
        if(map.hasLayer(heat))map.removeLayer(heat);
        heat=null
      }
    }
    const PALETTES={
      warm:{
        .2:'#ffffb2',.45:'#fecc5c',.7:'#fd8d3c',1:'#bd0026'
      },blue:{
        .2:'#eff3ff',.45:'#bdd7e7',.7:'#6baed6',1:'#08519c'
      },purple:{
        .2:'#542788',.45:'#998ec3',.7:'#f1a340',1:'#ffffb2'
      },gray:{
        .2:'#eeeeee',.45:'#bbbbbb',.7:'#777777',1:'#111111'
      }
    };
    DATA.forEach(d=>{
      const o=document.createElement('option');o.value=d.id;o.textContent=d.autor;$('author').append(o)
    });
    if(window.L){
      map=L.map('map',{
        zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false
      }).setView([30,20],3);
      [['base',200],['heat',350],['points',450],['names',750],['selection',700]].forEach(([name,z])=>{
        map.createPane(name);map.getPane(name).style.zIndex=z
      });
      map.getPane('heat').style.pointerEvents='none';
      points=L.layerGroup().addTo(map);
      names=L.layerGroup().addTo(map);
      geo=L.geoJSON(LAND,{
        pane:'base',interactive:false,attribution:'Mapa base: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> (dominio público)',style:{
          color:'#aab8b8',weight:.7,fillColor:'#f1f0e9',fillOpacity:1
        }
      }).addTo(map);
      map.on('moveend zoomend resize',()=>requestAnimationFrame(collisions))
    } else{
      $('map').textContent='No se pudo cargar Leaflet. Comprueba la conexión. Las fichas siguen accesibles en el listado.'
    }
    const dataset=()=>DATA.find(d=>d.id===$('author').value);
    const selectedRelations=()=>[...document.querySelectorAll('.qamus-choice:checked')].map(e=>e.value);
    const clearRelations=()=>document.querySelectorAll('.qamus-choice').forEach(e=>e.checked=false);
    const active=()=>{
      const d=dataset(),relations=selectedRelations();
      return d.features.filter(f=>(d.id!=='alcala'||(!$('additions').checked&&!$('reductions').checked)||($('additions').checked&&f.addition===true)||($('reductions').checked&&f.reduced===true))&&(d.id!=='ecchellensis'||!relations.length||(!f.doubt&&relations.some(r=>(f.qamus_relations||[]).includes(r)))))
    };
    const labelRaw = f =>
      String(f.labels[$('label').value] ?? 'Forma no consignada');
    const labelText = f => sinCursivas(labelRaw(f));
    function labelHTML(f){
      return labelText(f).split(/([\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+(?:[\s\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]*[\u0600-\u06ff])?)/g).map(t=>/[\u0600-\u06ff]/.test(t)?'<bdi class="arabic">'+esc(t)+'</bdi>':esc(t)).join('')
    }
    function linkedTexto(el,value){
      const s=String(value),re=/https?:\/\/[^\s<>«»]+/g;
      let start=0,m;
      while((m=re.exec(s))){
        el.append(document.createTextNode(s.slice(start,m.index)));
        const u=m[0].replace(/[),.;]+$/,'');
        const a=document.createElement('a');
        a.href=u;
        a.textContent=u;
        a.target='_blank';
        a.rel='noopener noreferrer';
        el.append(a,document.createTextNode(m[0].slice(u.length)));
        start=m.index+m[0].length
      }
      el.append(document.createTextNode(s.slice(start)))
    }
    function linked(el, value) {
  const texto = String(value);
  const patron = /<i>([\s\S]*?)<\/i>/g;
  let inicio = 0;
  let coincidencia;

  while ((coincidencia = patron.exec(texto)) !== null) {
    linkedTexto(el, texto.slice(inicio, coincidencia.index));

    const cursiva = document.createElement('i');
    linkedTexto(cursiva, coincidencia[1]);
    el.append(cursiva);

    inicio = patron.lastIndex;
  }

  linkedTexto(el, texto.slice(inicio));
}
    function block(title,fields,open){
      const section=document.createElement('details');
      section.open=open;
      const summary=document.createElement('summary');
      summary.className='group-title';
      summary.textContent=title;
      section.append(summary);
      Object.entries(fields).forEach(([k,v])=>{
        const card=document.createElement('div');card.className='card';const heading=document.createElement('h3');heading.textContent=k;const body=document.createElement('p');body.dir='auto';linked(body,k==='Relación con al-Qāmūs al-Muḥīṭ'?String(v).replace(/Sin correspondencia/g,'Nula'):v);card.append(heading,body);section.append(card)
      });
      return section
    }
    function ficha(f){
      selectedId=f.id;
      const panel=$('detail');
      panel.replaceChildren();
      const h = document.createElement('h2');
      h.dir = 'auto';
      linked(h, labelRaw(f));
      panel.append(h);
      const sub=document.createElement('div');
      sub.className='muted';
      sub.innerHTML=dataset().title;
      panel.append(sub,block('Información filológica',f.phil,true),block('Información cartográfica',f.cart,false));
      render();
      if(map)map.panTo([f.xy[1],f.xy[0]])
    }
    function fit(fs){
      if(map&&fs.length)map.fitBounds(L.latLngBounds(fs.map(f=>[f.xy[1],f.xy[0]])),{
        padding:[45,45],maxZoom:8
      })
    }
    function collisions(){
      if(!map)return;
      let hidden=0;
      const accepted=[],bounds=$('map').getBoundingClientRect();
      for(const o of [...labelObjects].sort((a,b)=>b.priority-a.priority)){
        const el=o.marker.getElement();
        if(!el)continue;
        el.style.display='';
        const span=el.querySelector('span'),b=span.getBoundingClientRect();
        const off=b.right<bounds.left||b.left>bounds.right||b.bottom<bounds.top||b.top>bounds.bottom;
        const overlaps=accepted.some(a=>b.left<a.right+3&&b.right>a.left-3&&b.top<a.bottom+3&&b.bottom>a.top-3);
        if(off||($('layout').value==='adaptive'&&overlaps)){
          el.style.display='none';
          if(!off)hidden++
        } else accepted.push(b)
      }
      $('status').textContent=statusText+(hidden?' | '+hidden+' etiquetas ocultas por solapamiento. Amplía para ver más o elige como distribución Mostrar todas':'')
    }
    function citationOutput(){
      const title='Mapas del pensamiento: toponimia en obras filológicas orientalistas';
      const names={
        alcala:[['Vocabulista',true],[' y ',false],['Arte',true],[' de Pedro de Alcalá',false]],dobelio:[['Grammatica arabica',true],[' de Marcos Dobelio',false]],ecchellensis:[['Nomenclator Arabico-Latinus',true],[' de Abraham Ecchellensis',false]],leon:[['Thesauro arabicae',true],[' de Tomás de León',false]]
      };
      const url=location.protocol.startsWith('http')?location.href.split('#')[0]:'[URL pública pendiente]';
      const selected=$('citationScope').value==='dataset',parts=[];
      const add=(text,italic=false)=>parts.push({
        text,italic
      });
      const collection=()=>{
        if(selected){
          add(' Conjunto: ');
          for(const [text,italic] of names[dataset().id])add(text,italic);
          add('.');
        }
      };
      if(citationFormat==='MLA'){
        add('Sánchez-García, Patricia Carina. ');
        add(title,true);
        add('. Versión 1.0, 13 oct. 2026.');
        collection();
        add(' '+url+'. Consultado el '+new Date().toLocaleDateString('es-ES')+'.');
      } else if(citationFormat==='Chicago'){
        add('Sánchez-García, Patricia Carina. ');
        add(title,true);
        add('. Versión 1.0. 13 de octubre de 2026.');
        collection();
        add(' '+url+'. Consultado el '+new Date().toLocaleDateString('es-ES')+'.');
      } else{
        add('Sánchez-García, P. C. (2026). ');
        add(title,true);
        add(' (Versión 1.0) [Visor cartográfico].');
        collection();
        add(' '+url+'.');
      }
      return{
        text:parts.map(p=>p.text).join(''),html:parts.map(p=>p.italic?'<i>'+esc(p.text)+'</i>':esc(p.text)).join('')
      };
    }
    function citation(){
      return citationOutput().text;
    }
    function updateCitation(){
      $('citation').innerHTML=citationOutput().html;
      $('copyStatus').textContent=''
    }
    async function copyCitation(){
      const value=citationOutput();
      try{
        if(navigator.clipboard&&navigator.clipboard.write&&window.ClipboardItem){
          await navigator.clipboard.write([new ClipboardItem({
            'text/plain':new Blob([value.text],{
              type:'text/plain'
            }),'text/html':new Blob(['<p>'+value.html+'</p>'],{
              type:'text/html'
            })
          })]);
          $('copyStatus').textContent=' Cita copiada con formato.';
          return;
        }
      } catch(e){
        console.warn(e);
      }
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText){
          await navigator.clipboard.writeText(value.text);
          $('copyStatus').textContent=' Cita copiada en texto plano.';
          return;
        }
      } catch(e){
        console.warn(e);
      }
      const area=document.createElement('textarea');
      area.value=value.text;
      area.setAttribute('readonly','');
      area.style.position='fixed';
      area.style.left='-9999px';
      document.body.append(area);
      area.select();
      let ok=false;
      try{
        ok=document.execCommand('copy')
      } catch(e){
        console.warn(e)
      }
      area.remove();
      $('copyStatus').textContent=ok?' Cita copiada en texto plano.':' Selecciona y copia el texto de la cita.';
    }
    function paletteStops(){
      return Object.entries(PALETTES[$('palette').value]).map(([position,color])=>[Number(position),color]).sort((a,b)=>a[0]-b[0]);
    }
    function palette(){
      const stops=paletteStops().map(([position,color])=>color+' '+position*100+'%');
      $('paletteBar').style.background='linear-gradient(to right,'+stops.join(',')+')';
      $('paletteLegend').hidden=!heatOn;
      $('palette').disabled=!heatOn
    }
    function render(){
      const fs=active(),q=norm($('search').value),matches=new Map();
      hits=fs.filter(f=>{
        if(!q)return false;const fields=$('scope').value==='names'?f.labels:{
          ...f.phil,...f.cart
        };const keys=Object.entries(fields).filter(([k,v])=>norm(v).includes(q)).map(([k])=>k);if(keys.length){
          matches.set(f.id,keys);return true
        }
        return false
      });
      const ids=new Set(hits.map(f=>f.id));
      $('list').replaceChildren();
      if(points)points.clearLayers();
      if(names)names.clearLayers();
      labelObjects=[];
      if(!heatOn)removeHeat();
      const collator=new Intl.Collator($('label').value.startsWith('Árabe')?'ar':'es',{
        sensitivity:'base',numeric:true
      });
      [...fs].filter(f=>!q||ids.has(f.id)).sort((a,b)=>collator.compare(labelText(a),labelText(b))||a.id.localeCompare(b.id)).forEach(f=>{
        const hit=ids.has(f.id),button=document.createElement('button');button.textContent=labelText(f)+(hit?' — '+matches.get(f.id).join(', '):'');button.dir='auto';if(hit)button.className='hit';button.onclick=()=>ficha(f);$('list').append(button)
      });
      fs.forEach(f=>{
        const hit=ids.has(f.id),chosen=f.id===selectedId;if(!map)return;const pos=[f.xy[1],f.xy[0]],area=['area','sea'].includes(f.kind),color=f.doubt?'#b95809':(['sea','river'].includes(f.kind)?'#236d97':'#1c2427');if(!area&&$('showPoints').checked){
          const m=L.circleMarker(pos,{
            pane:'points',radius:4,color,fillColor:color,weight:1,fillOpacity:.85
          }).addTo(points);if(!$('labels').checked){
            const t=document.createElement('span');t.textContent=labelText(f);m.bindPopup(t)
          }
          m.on('click',()=>ficha(f));if(hit||chosen)L.circleMarker(pos,{
            pane:'selection',radius:10,color:hit?'#9c2477':'#4b646a',fillOpacity:0,weight:2,interactive:false
          }).addTo(points)
        }
        if($('labels').checked){
          const marker=L.marker(pos,{
            pane:'names',icon:L.divIcon({
              className:'phil-label '+f.kind+(f.doubt?' doubt':'')+(hit?' hit':'')+(chosen?' chosen':''),html:'<span dir="auto">'+labelHTML(f)+'</span>',iconSize:[0,0],iconAnchor:[0,0]
            }),keyboard:true,title:labelText(f)
          }).addTo(names).on('click',()=>ficha(f));labelObjects.push({
            marker,priority:chosen?2:hit?1:0
          })
        }
      });
      let note='';
      if(heatOn){
        if(map&&PaneSafeHeat){
          try{
            const eligible=fs.filter(f=>f.heat_include===true||(f.heat_include===null&&!f.doubt));
            const coords=eligible.map(f=>[f.xy[1],f.xy[0],1]),opts={
              radius:25,blur:15,maxZoom:6,max:1,gradient:PALETTES[$('palette').value]
            };
            if(!heat)heat=new PaneSafeHeat(coords,opts).addTo(map);
            else{
              heat.setLatLngs(coords);
              heat.setOptions(opts)
            }
            note=' | Mapa de calor: '+eligible.length+' registros'
          } catch(e){
            console.error(e);
            try{
              removeHeat()
            } catch(cleanup){
              console.error(cleanup)
            }
            heatOn=false;
            $('heatToggle').setAttribute('aria-pressed','false');
            $('heatToggle').textContent='Mapa de calor: desactivado';
            note=' · Error de calor: '+e.message+'; consulta disponible'
          }
        } else note=' · Complemento de calor no cargado'
      }
      statusText=fs.length+' registros'+(q?' | '+hits.length+' coincidencias':'')+note;
      $('status').textContent=statusText;
      palette();
      updateCitation();
      requestAnimationFrame(collisions)
    }
    function change(){
      const d=dataset();
      $('title').innerHTML=d.title;
      document.documentElement.style.setProperty('--work',d.color);
      $('label').replaceChildren();
      Object.keys(d.features[0].labels).filter(k=>d.features.some(f=>f.labels[k]!==null&&f.labels[k]!=='')).forEach(k=>{
        const o=document.createElement('option');o.value=k;o.textContent=k;$('label').append(o)
      });
      $('additionBox').hidden=d.id!=='alcala';
      $('qamusBox').hidden=d.id!=='ecchellensis';
      clearRelations();
      $('reductions').checked=false;
      $('additions').checked=false;
      $('additions').disabled=!d.additionsValidated;
      $('additionText').innerHTML='Mostrar solo puntos agregados respecto a '+(d.baseHtml||'la fuente de base');
      $('additionHint').textContent='';
      $('additionHint').hidden=true;
      selectedId=null;
      $('search').value='';
      $('detail').textContent='Selecciona una entrada para consultar su ficha.';
      render();
      fit(active())
    }
    function base(){
      if(!map)return;
      if(tiles){
        const previous=tiles;
        tiles=null;
        if(map.hasLayer(previous))map.removeLayer(previous)
      }
      if(map.hasLayer(geo))map.removeLayer(geo);
      if($('base').value==='clear'){
        geo.addTo(map);
        return
      }
      const layer=L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',{
        pane:'base',crossOrigin:true,maxNativeZoom:13,maxZoom:19,attribution:'© Mapa base: <a href="https://cloudless.eox.at/" target="_blank" rel="noopener noreferrer">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) | <a href="https://cloudless.eox.at/license-non-commercial" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a>'
      });
      tiles=layer;
      let failed=false;
      layer.on('tileerror',()=>{
        if(failed||tiles!==layer)return;failed=true;if(map.hasLayer(layer))map.removeLayer(layer);tiles=null;$('base').value='clear';geo.addTo(map);console.warn('EOX no disponible; se mantiene Base clara.')
      });
      layer.addTo(map)
    }
    $('base').onchange=base;
    const initialDetails=[...document.querySelectorAll('details')].map(el=>({
      el,open:el.open
    }));
    function resetAll(){
      heatOn=false;
      removeHeat();
      $('heatToggle').setAttribute('aria-pressed','false');
      $('heatToggle').textContent='Mapa de calor: desactivado';
      $('author').value=DATA[0].id;
      $('labels').checked=true;
      $('showPoints').checked=true;
      $('layout').value='adaptive';
      $('scope').value='all';
      $('palette').value='warm';
      $('base').value='clear';
      citationFormat='APA';
      $('citationScope').value='site';
      document.querySelectorAll('[data-format]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.format==='APA')));
      initialDetails.forEach(({
        el,open
      })=>el.open=open);
      change();
      base();
    }
    $('resetFilters').onclick=resetAll;
    document.querySelectorAll('.qamus-choice').forEach(el=>el.onchange=()=>{
      selectedId=null;$('detail').textContent='Selecciona una entrada.';render();fit(active())
    });
    $('reductions').onchange=()=>{
      selectedId=null;
      $('detail').textContent='Selecciona una entrada.';
      render();
      fit(active())
    };
    $('openBibliography').onclick=()=>{
      $('bibliography').querySelector('details').open=true
    };
    $('author').onchange=change;
    ['labels','showPoints','layout','scope','palette'].forEach(id=>$(id).onchange=render);
    $('label').onchange=()=>{
      const f=dataset().features.find(f=>f.id===selectedId);
      if(f)ficha(f);
      else render()
    };
    $('search').oninput=render;
    $('additions').onchange=()=>{
      selectedId=null;
      $('detail').textContent='Selecciona una entrada.';
      render();
      fit(active())
    };
    $('heatToggle').onclick=()=>{
      heatOn=!heatOn;
      $('heatToggle').setAttribute('aria-pressed',String(heatOn));
      $('heatToggle').textContent='Mapa de calor: '+(heatOn?'activado':'desactivado');
      render()
    };
    $('fitsearch').onclick=()=>fit(hits);
    $('reset').onclick=()=>{
      $('search').value='';
      render();
      fit(active())
    };
    document.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>{
      citationFormat=b.dataset.format;document.querySelectorAll('[data-format]').forEach(a=>a.setAttribute('aria-selected',String(a===b)));updateCitation()
    });
    $('citationScope').onchange=updateCitation;
    $('copy').onclick=copyCitation;
    [['ilcLogo','ilcFallback'],['uaLogo','uaFallback']].forEach(([i,f])=>$(i).onerror=()=>{
      $(i).hidden=true;$(f).hidden=false
    });
    $('institutionLogo').onerror=()=>{
      $('institutionLogo').hidden=true;
      $('logoFallback').hidden=false
    };
    $('excel').onclick=()=>{
      if(!window.XLSX)return alert('Biblioteca Excel no cargada.');
      const d=dataset(),fs=active(),wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(fs.map(f=>Object.fromEntries(Object.entries({
        ...f.phil,...f.cart
      }).map(([k,v])=>[k,k==='Relación con al-Qāmūs al-Muḥīṭ'
  ? sinCursivas(v).replace(/Sin correspondencia/g,'Nula')
  : sinCursivas(v)])))),'Datos');
      const dict=[...new Set(fs.flatMap(f=>Object.keys(f.phil)))].map(k=>({
        Campo:k,Bloque:'Información filológica'
      })).concat([...new Set(fs.flatMap(f=>Object.keys(f.cart)))].map(k=>({
        Campo:k,Bloque:'Información cartográfica'
      })));
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dict),'Diccionario');
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{
        Version:'1.0',Conjunto:d.title.replace(/<[^>]*>/g,''),Registros:fs.length,Cita:citation(),Seleccion:dataset().id==='ecchellensis'?(selectedRelations().join(', ')||'Repertorio completo'):[$('additions').checked?'Agregado':'',$('reductions').checked?'Reducido':''].filter(Boolean).join(', ')||'Repertorio completo',Coordenadas:'Posiciones de etiquetas, no límites territoriales'
      }]),'Metadatos');
      XLSX.writeFile(wb,d.id+'_datos_normalizados_v10.xlsx')
    };
    async function waitTiles(){
      if(!tiles)return;
      const until=Date.now()+10000;
      while(Date.now()<until){
        const imgs=[...$('map').querySelectorAll('.leaflet-tile')];
        if(imgs.length&&imgs.every(i=>i.complete&&i.naturalWidth>0))return;
        await new Promise(r=>setTimeout(r,120));
      }
      throw Error('El fondo no ha terminado de cargar. Espera o vuelve a intentarlo; no se exportará una imagen incompleta.');
    }
    function drawLand(ctx){
      ctx.fillStyle='#e4ebed';
      ctx.fillRect(0,0,map.getSize().x,map.getSize().y);
      ctx.fillStyle='#f1f0e9';
      ctx.strokeStyle='#aab8b8';
      ctx.lineWidth=.7;
      const g=LAND.geometry,polys=g.type==='MultiPolygon'?g.coordinates:[g.coordinates];
      for(const poly of polys){
        ctx.beginPath();
        for(const ring of poly){
          ring.forEach((xy,i)=>{
            const p=map.latLngToContainerPoint([xy[1],xy[0]]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)
          });
          ctx.closePath();
        }
        ctx.fill('evenodd');
        ctx.stroke();
      }
    }
    function drawWrapped(ctx,text,x,y,width,lineHeight,alignment){
      ctx.save();
      try{
        const rtl=ctx.direction==='rtl';
        const align=alignment==='center'?'center':alignment==='right'||(alignment!=='left'&&rtl)?'right':'left';
        ctx.textAlign=align;
        const anchor=align==='center'?x+width/2:align==='right'?x+width:x;
        const lines=exportLines(ctx,text,width);
        lines.forEach((line,i)=>ctx.fillText(line,anchor,y+i*lineHeight));
      } finally{
        ctx.restore();
      }
    }
    function exportLines(context,text,maxWidth){
      const lines=[];
      for(const paragraph of String(text).split(/\n/)){
        let line='';
        for(const word of paragraph.split(/\s+/).filter(Boolean)){
          const candidate=line?line+' '+word:word;
          if(context.measureText(candidate).width<=maxWidth){
            line=candidate;
            continue
          }
          if(line){
            lines.push(line);
            line=''
          }
          if(context.measureText(word).width<=maxWidth){
            line=word;
            continue
          }
          let part='';
          for(const ch of word){
            if(part&&context.measureText(part+ch).width>maxWidth){
              lines.push(part);
              part=ch
            } else part+=ch
          }
          line=part
        }
        if(line)lines.push(line);
        else if(!paragraph.trim())lines.push('')
      }
      return lines
    }
    function exportLineBlock(context,lines,x,y,lineHeight){
      context.textBaseline='top';
      lines.forEach((line,i)=>context.fillText(line,x,y+i*lineHeight));
      return y+lines.length*lineHeight
    }
    async function image(withCard){
      if(!map)return alert('El mapa no está disponible.');
      if(withCard&&!selectedId)return alert('Abre primero una ficha.');
      if(withCard&&!window.html2canvas)return alert('No se ha cargado la biblioteca de captura de ficha.');
      const button=withCard?$('pngcard'):$('png');
      button.disabled=true;
      try{
        map.stop();
        map.closePopup();
        await waitTiles();
        if(document.fonts)await document.fonts.ready;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        collisions();
        const sz=map.getSize(),rect=$('map').getBoundingClientRect(),scale=2;
        const chart=document.createElement('canvas');
        chart.width=sz.x*scale;
        chart.height=sz.y*scale;
        const ctx=chart.getContext('2d');
        ctx.scale(scale,scale);
        if(!tiles){
          drawLand(ctx)
        } else{
          ctx.fillStyle="#e4ebed";
          ctx.fillRect(0,0,sz.x,sz.y)
        }
        if(tiles){
          const imgs=[...$('map').querySelectorAll('.leaflet-tile')];
          ctx.globalAlpha=1;
          for(const img of imgs){
            const b=img.getBoundingClientRect();
            ctx.drawImage(img,b.left-rect.left,b.top-rect.top,b.width,b.height)
          }
          ctx.globalAlpha=1;
        }
        if(heatOn&&heat&&heat._canvas){
          const b=heat._canvas.getBoundingClientRect();
          ctx.drawImage(heat._canvas,b.left-rect.left,b.top-rect.top,b.width,b.height)
        }
        const hitIds=new Set(hits.map(f=>f.id));
        if($('showPoints').checked)for(const f of active()){
          if(['area','sea'].includes(f.kind))continue;
          const p=map.latLngToContainerPoint([f.xy[1],f.xy[0]]);
          const color=f.doubt?'#b95809':(['sea','river'].includes(f.kind)?'#236d97':'#1c2427');
          ctx.fillStyle=color;
          ctx.strokeStyle=color;
          ctx.beginPath();
          ctx.arc(p.x,p.y,4,0,Math.PI*2);
          ctx.globalAlpha=.85;
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha=1;
          if(hitIds.has(f.id)||f.id===selectedId){
            ctx.strokeStyle=hitIds.has(f.id)?'#9c2477':'#4b646a';
            ctx.lineWidth=2;
            ctx.beginPath();
            ctx.arc(p.x,p.y,10,0,Math.PI*2);
            ctx.stroke();
            ctx.lineWidth=1
          }
        }
        if($('labels').checked)for(const o of labelObjects){
          const el=o.marker.getElement();
          if(!el||el.style.display==='none')continue;
          const span=el.querySelector('span'),b=span.getBoundingClientRect(),style=getComputedStyle(span),x=b.left-rect.left,y=b.top-rect.top;
          ctx.fillStyle='rgba(255,255,255,.82)';
          ctx.fillRect(x,y,b.width,b.height);
          ctx.save();
          ctx.fillStyle=style.color;
          ctx.font=style.font||'13px Arial';
          ctx.textBaseline='top';
          ctx.direction=style.direction;
          const txt=(el.classList.contains('area')||el.classList.contains('sea'))?span.textContent.toLocaleUpperCase('es'):span.textContent;
          drawWrapped(ctx,txt,x+4,y+2,b.width-8,parseFloat(style.lineHeight)||17,style.textAlign);
          ctx.restore();
          ctx.textBaseline='alphabetic';
          ctx.direction='inherit';
          if(o.priority){
            ctx.strokeStyle=o.priority===2?'#4b646a':'#9c2477';
            ctx.strokeRect(x,y,b.width,b.height)
          }
        }
        let card = null;
        if (withCard) {
          const detailEl = $('detail');
          const originalScrollTop = detailEl.scrollTop;
          const originalOverflow = detailEl.style.overflow;
          const originalHeight = detailEl.style.height;
          detailEl.scrollTop = 0;
          detailEl.style.overflow = 'visible';
          detailEl.style.height = 'max-content';
          card = await html2canvas(detailEl, {
            scale: 2,
            useCORS: true,
            backgroundColor: getComputedStyle(detailEl).backgroundColor,
            logging: false,
            scrollY: -window.scrollY,
            scrollX: -window.scrollX
          });
          detailEl.style.overflow = originalOverflow;
          detailEl.style.height = originalHeight;
          detailEl.scrollTop = originalScrollTop;
        }
        const canvas=document.createElement('canvas');
        canvas.width=chart.width+(card?card.width:0);
        const c=canvas.getContext('2d'),padding=28,textWidth=canvas.width-padding*2;
        const title=document.querySelector('header h1').textContent.trim()+' — '+$('title').textContent.trim();
        const metadata=document.querySelector('header .muted').textContent.trim();
        const legend=document.querySelector('.legend').textContent.trim();
        const source=map.attributionControl.getContainer().textContent.replace(/\s+/g,' ').trim();
        const count=$('status').textContent.trim();
        c.font='26px Arial';
        const titleLines=exportLines(c,title,textWidth);
        c.font='19px Arial';
        const metadataLines=exportLines(c,metadata,textWidth),countLines=exportLines(c,count,textWidth),legendLines=exportLines(c,legend,textWidth);
        c.font='17px Arial';
        const sourceLines=exportLines(c,source,textWidth);
        const headerHeight=padding+titleLines.length*34+12+metadataLines.length*27+10+countLines.length*25+padding;
        const bodyHeight=Math.max(chart.height,card?card.height:0);
        const footerHeight=padding+legendLines.length*27+18+sourceLines.length*25+(heatOn?48:0)+padding;
        canvas.height=Math.ceil(headerHeight+bodyHeight+footerHeight);
        c.fillStyle='white';
        c.fillRect(0,0,canvas.width,canvas.height);
        c.fillStyle='#263337';
        let y=padding;
        c.font='26px Arial';
        y=exportLineBlock(c,titleLines,padding,y,34)+12;
        c.font='19px Arial';
        y=exportLineBlock(c,metadataLines,padding,y,27)+10;
        y=exportLineBlock(c,countLines,padding,y,25);
        c.drawImage(chart,0,headerHeight);
        if(card)c.drawImage(card,chart.width,headerHeight);
        y=headerHeight+bodyHeight+padding;
        c.font='19px Arial';
        y=exportLineBlock(c,legendLines,padding,y,27)+18;
        c.font='17px Arial';
        y=exportLineBlock(c,sourceLines,padding,y,25)+12;
        if(heatOn){
          const width=Math.min(240,canvas.width-240),x=110;
          const grad=c.createLinearGradient(x,0,x+width,0);
          paletteStops().forEach(([position,color])=>grad.addColorStop(position,color));
          c.fillStyle=grad;
          c.fillRect(x,y,width,14);
          c.fillStyle='#263337';
          c.textBaseline='top';
          c.fillText('Menor',padding,y);
          c.fillText('Mayor concentración',x+width+12,y)
        }
        const a=document.createElement('a');
        a.download=dataset().id+(withCard?'_mapa_ficha':'_mapa')+'_v10.png';
        a.href=canvas.toDataURL('image/png');
        a.click();
      } catch(e){
        console.error(e);
        alert('No se ha exportado la imagen: '+e.message);
      } finally{
        button.disabled=false
      }
    }
    $('png').onclick=()=>image(false);
    $('pngcard').onclick=()=>image(true);
    change();
    base();

    aviso.hidden = true;
  } catch (error) {
    console.error("No se ha podido iniciar el visor:", error);
    controles.forEach(elemento => { elemento.disabled = true; });
    aviso.hidden = false;
    aviso.classList.add("error");
    aviso.setAttribute("role", "alert");
    aviso.replaceChildren();
    const mensaje = document.createElement("p");
    mensaje.textContent = "No se han podido cargar los datos del visor. " + error.message;
    aviso.append(mensaje);
    const ayuda = document.createElement("p");
    ayuda.textContent = location.protocol === "file:"
      ? "Abre esta versión mediante un servidor local o GitHub Pages; no mediante doble clic en el HTML."
      : "Comprueba que docs/data contiene repertorios.json y base-clara.geojson, y que la publicación ha terminado.";
    aviso.append(ayuda);
    const reintentar = document.createElement("button");
    reintentar.type = "button";
    reintentar.textContent = "Volver a cargar";
    reintentar.onclick = () => location.reload();
    aviso.append(reintentar);
  }
}

iniciarVisor();
