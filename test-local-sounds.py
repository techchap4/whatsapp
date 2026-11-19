#!/usr/bin/env python3
"""Browser integration tests: python test-local-sounds.py (requires playwright and Chromium).
Uses a local stub for Supabase/settings and generated dummy WAVs; never uses real user data.
"""
import io, math, os, struct, threading, wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
app = (ROOT / 'app.js').read_text()
extras = (ROOT / 'extras.js').read_text()
sound_code = app[app.index('let ac = null;'):app.index('/* ---------------- auth screen')]
settings_code = extras[extras.index('let settingsView = '):]
assert "const playSend = () => { if (soundOn()) tone(620, 0, 0.1, 0.1); };" in sound_code
harness = '''<!doctype html><html><body><div id="pane-settings"></div><script src="/local-sounds.js"></script><script>
const $ = id => document.getElementById(id);
let me = {id:'test',email:'test@example.invalid'}, profiles = {test:{username:'test'}}, myBlocks=new Set(), messages=[];
let stats=[]; class FakeAC { constructor(){this.state='running';this.currentTime=0;this.destination={};} resume(){} createOscillator(){return {frequency:{value:0},connect(){},start(){stats.push(this.frequency.value)},stop(){}}} createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}}} }; window.AudioContext=FakeAC;
const s={notif:{messages:true,desktop:false,ringtone:true,vibrate:false,updates:true},privacy:{},chats:{}};
let switchTab=()=>{}; const S=()=>s, saveSettings=async fn=>{fn(s);return true}, THEMES=[], avatar=()=>'', esc=x=>x, nameOf=p=>p.username, vb=()=>'', verifCard=()=>'', openVerify=()=>{}, toast=()=>{}, registerPush=()=>{};
window.played=[]; const originalPlay=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){window.played.push(this.src); return originalPlay.call(this)};
''' + sound_code + settings_code + '''
settingsView='notif'; renderSettings();
</script></body></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def do_GET(self):
        if self.path == '/harness':
            data=harness.encode(); self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
        else: super().do_GET()
    def log_message(self, *args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}'

def wav_bytes():
    b=io.BytesIO()
    with wave.open(b,'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(4000*math.sin(2*math.pi*440*i/8000))) for i in range(800)))
    return b.getvalue()

try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
    context=browser.new_context()
    page=context.new_page(); errors=[]; requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append((r.method, r.url)))
    page.goto(url+'/harness'); active=page.locator('#local-sound-active'); name=page.locator('#local-sound-name'); status=page.locator('#local-sound-status')
    expect(active).to_have_value('default')
    expect(page.locator('#local-sound-active option[value=Bottle]')).to_be_disabled()
    assert page.locator('#local-sound-active option').count()==21
    page.evaluate('playReceive(); playSend()'); assert page.evaluate('stats') == [880,1175,620]
    # File is generated locally, never shipped as a product sound.
    name.select_option('Bottle'); page.locator('#local-sound-file').set_input_files({'name':'dummy.wav','mimeType':'audio/wav','buffer':wav_bytes()})
    page.locator('#local-sound-import').click(); expect(status).to_contain_text('saved locally')
    expect(page.locator('#local-sound-active option[value=Bottle]')).to_be_enabled()
    active.select_option('Bottle'); page.locator('#local-sound-preview').click(); expect(status).to_have_text('Preview finished.',timeout=5000)
    assert page.evaluate('played.length')==1
    page.evaluate('playReceive()'); page.wait_for_function('played.length===2')
    page.reload(); expect(active).to_have_value('Bottle'); expect(page.locator('#local-sound-active option[value=Bottle]')).to_be_enabled()
    page.locator('[data-k=sound]').uncheck(); page.evaluate('stats=[]; played=[]; playReceive(); playSend()'); page.wait_for_timeout(250)
    assert page.evaluate('stats.length===0 && played.length===0')
    page.locator('#local-sound-preview').click(); expect(status).to_contain_text('Turn on')
    page.locator('[data-k=sound]').check(); page.wait_for_timeout(300)
    page.evaluate('stats=[]; played=[]'); active.select_option('none'); page.evaluate('playReceive(); playSend()'); page.wait_for_timeout(250)
    assert page.evaluate('stats')==[620] and page.evaluate('played.length')==0
    page.locator('#local-sound-preview').click(); expect(status).to_contain_text('silent')
    active.select_option('Bottle'); name.select_option('Bottle'); page.locator('#local-sound-delete').click(); expect(active).to_have_value('default'); expect(page.locator('#local-sound-active option[value=Bottle]')).to_be_disabled()
    page.reload(); expect(active).to_have_value('default')
    # Corrupt file must not throw unhandled errors or stop the chat code.
    name.select_option('Bubble'); page.locator('#local-sound-file').set_input_files({'name':'bad.wav','mimeType':'audio/wav','buffer':b'bad audio'})
    page.locator('#local-sound-import').click(); expect(status).to_contain_text('saved locally'); active.select_option('Bubble')
    page.locator('#local-sound-preview').click(); expect(status).to_contain_text('browser',timeout=5000)
    page.evaluate('playReceive(); playSend()'); page.wait_for_timeout(300)
    assert not errors, errors
    assert all(method == 'GET' and (r.startswith(url) or r.startswith('blob:'+url)) for method, r in requests), requests
    print('PASS: initial default, 19 missing names, real dummy WAV import and playback, incoming selection and reload persistence, mute/preview, None, unchanged send tone, deletion, invalid playback handling, no network upload.')
    context.close(); browser.close()
finally:
    server.shutdown()
