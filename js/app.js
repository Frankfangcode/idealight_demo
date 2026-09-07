/* ==========================================================================
   模擬展示版邏輯 — 純前端，無後端、無 API
   「AI」的所有回答都來自 data.js 的罐頭內容，依目前溫度設定挑選版本，
   並以打字動畫模擬真實對話的節奏。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 狀態 */

  const S = {
    temp: 'low',        // low | high （溫度操弄）
    group: 'exp',       // exp | ctrl （實驗組＝AI 回饋／控制組＝無回饋）
    step: 0,            // 0 案情 1 證詞 2 訊問 3 判斷 4 回饋
    read: {},           // 翻開過的證詞卡
    chats: {},          // charKey -> [{who:'me'|'them', text, temp}]
    askedCount: {},     // charKey -> 已提問次數
    pick: null,
    reason: '',
    submitted: false,
    botOpen: false,
    botSeen: false,
    botLog: [],
    activeChar: null,
  };

  const STEPS = [
    { key: 'intro', label: '案情' },
    { key: 'testimony', label: '六人證詞' },
    { key: 'interrogation', label: '訊問' },
    { key: 'ranking', label: '推理判斷' },
    { key: 'feedback', label: '回饋' },
  ];

  const $ = (sel, el) => (el || document).querySelector(sel);
  const app = () => $('#app');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function charOf(key) {
    return DEMO.characters.find((c) => c.key === key);
  }

  function tempLabel() {
    return S.temp === 'low' ? '低溫 T≈0.2' : '高溫 T≈1.0';
  }

  /* 罐頭回答依溫度取版本 */
  function pickTemp(obj) {
    return obj[S.temp];
  }

  /* 自由提問 → 用字元 2-gram 重疊度比對最接近的預設問題，找不到就 fallback */
  function grams(str) {
    const s = str.replace(/[\s，。？！?,.!、]/g, '');
    const g = new Set();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  }

  function matchQuestion(char, input) {
    const ig = grams(input);
    let best = null;
    let bestScore = 0;
    char.questions.forEach((qa) => {
      const qg = grams(qa.q);
      let score = 0;
      ig.forEach((g) => { if (qg.has(g)) score++; });
      if (score > bestScore) { bestScore = score; best = qa; }
    });
    return bestScore >= 2 ? best : null;
  }

  /* ------------------------------------------------------------ demo 控制列 */

  function renderBar() {
    const bar = $('#demoBar');
    const groupDesc = S.group === 'exp'
      ? 'AI 逐一判斷六人說法有無瑕疵，並給批判思考引導'
      : '僅記錄作答，不提供任何 AI 回饋';
    const tempDesc = S.temp === 'low'
      ? 'AI 回答理性嚴謹、條列精確'
      : 'AI 回答口語活潑、帶情緒與表情符號';
    bar.innerHTML = `
      <span class="demo-tag">DEMO 模擬版</span>
      <div class="bar-group">
        <span>溫度</span>
        <div class="seg">
          <button data-temp="low" class="${S.temp === 'low' ? 'on' : ''}">低溫・嚴謹</button>
          <button data-temp="high" class="${S.temp === 'high' ? 'on' : ''}">高溫・活潑</button>
        </div>
      </div>
      <div class="bar-group">
        <span>組別</span>
        <div class="seg blue">
          <button data-group="exp" class="${S.group === 'exp' ? 'on' : ''}">實驗組・AI回饋</button>
          <button data-group="ctrl" class="${S.group === 'ctrl' ? 'on' : ''}">控制組・無回饋</button>
        </div>
      </div>
      <button class="reset-btn" id="resetBtn">重設 demo</button>
      <div class="mode-note">目前模式：<b>${tempDesc}</b>｜<b>${groupDesc}</b>。切換後新的 AI 回答立即生效，可對同一人重問比較差異。</div>
    `;
    bar.querySelectorAll('[data-temp]').forEach((b) =>
      b.addEventListener('click', () => { S.temp = b.dataset.temp; renderBar(); renderStep(); }));
    bar.querySelectorAll('[data-group]').forEach((b) =>
      b.addEventListener('click', () => { S.group = b.dataset.group; renderBar(); renderStep(); }));
    $('#resetBtn').addEventListener('click', () => location.reload());
  }

  /* ---------------------------------------------------------------- 導覽 */

  function renderStepper() {
    const el = $('#stepper');
    el.innerHTML = STEPS.map((st, i) => `
      <div class="step ${i === S.step ? 'on' : ''} ${i < S.step ? 'done' : ''}" data-i="${i}">
        <span class="n">PHASE ${i + 1}</span>${st.label}
      </div>`).join('');
    el.querySelectorAll('.step').forEach((b) =>
      b.addEventListener('click', () => go(Number(b.dataset.i))));
  }

  function go(i) {
    S.step = Math.max(0, Math.min(i, STEPS.length - 1));
    renderStepper();
    renderStep();
    window.scrollTo({ top: 0 });
  }

  /* ------------------------------------------------------------ 媒體資產 */

  /* 場景背景與人物照。每個底檔名旁若放同名 .mp4（如 img/bg_intro.mp4），
     載入成功會自動從靜態圖切換成無聲循環影片，不用改程式。 */
  const MEDIA = {
    bg: {
      intro: 'img/bg_intro',
      testimony: 'img/bg_testimony',
      interrogation: 'img/bg_interrogation',
      ranking: 'img/bg_ranking',
      feedback: 'img/bg_feedback',
    },
    charImg: (key) => `img/char_${key}.jpeg`,
    bot: 'img/bot.jpeg',
  };

  const avImg = (key) => `<img class="avatar photo" src="${MEDIA.charImg(key)}" alt="">`;

  let curScene = null;

  /* 全畫面電影背景：交叉淡入 + Ken Burns 慢速推鏡；有 mp4 就播影片 */
  function setScene(key) {
    if (curScene === key) return;
    curScene = key;
    const root = $('#sceneBg');
    if (!root) return;
    const base = MEDIA.bg[key];

    const layer = document.createElement('div');
    layer.className = 'layer';
    const img = document.createElement('img');
    img.className = 'bg-media';
    img.src = base + '.jpeg';
    img.alt = '';
    layer.appendChild(img);
    root.appendChild(layer);

    /* 嘗試載入同名影片；成功才替換（失敗時安靜地維持靜態圖） */
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
      v.className = 'bg-media';
      v.src = base + '.mp4';
      v.addEventListener('loadeddata', () => {
        if (curScene !== key) return;
        layer.replaceChildren(v);
        v.play().catch(() => {});
      });
    }

    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('show')));
    [...root.children].slice(0, -1).forEach((old) => {
      old.classList.remove('show');
      setTimeout(() => old.remove(), 1500);
    });
  }

  /* ------------------------------------------------------------ 各階段畫面 */

  function renderStep() {
    setScene(STEPS[S.step].key);
    const fns = [viewIntro, viewTestimony, viewInterrogation, viewRanking, viewFeedback];
    fns[S.step]();
  }

  function viewIntro() {
    const howto = [
      { n: '01', t: '看案情', d: '一盒蛋糕從冰箱裡消失了。先讀完案發紀錄。' },
      { n: '02', t: '讀證詞', d: '六個人各說一段自己看到、聽到的事。' },
      { n: '03', t: '訊問', d: '對任何人追問，看他的說法撐不撐得住。' },
      { n: '04', t: '判斷', d: '選出「最不合理」的說法，寫下你的理由。' },
      { n: '05', t: '回饋', d: '看看你的推理哪裡站得住、哪裡被帶風向。' },
    ];
    app().innerHTML = `
      <div class="hero">
        <div class="eyebrow">互動批判思考偵探遊戲 ／ 模擬展示</div>
        <div class="display"><span class="l1">MOON</span><span class="l2">ECLIPSE</span></div>
        <h1 class="zh-display">${DEMO.meta.title}</h1>
        <p class="tagline">監視器沒有正對冰箱。六個人的說法，是你唯一的畫面——而每一句，都只說了一部分。</p>
      </div>

      <section class="intro-sec">
        <div class="sec-head"><span class="eyebrow">WHAT IS THIS ／ 這個遊戲要做什麼</span></div>
        <p class="intro-lead">你<b>不是要找出兇手</b>。你要做的是：聽六個人講話，分辨誰說的是<b>親眼所見</b>、誰在<b>自行推測</b>，然後找出<b>最站不住腳的那一句</b>。</p>
        <div class="howto">
          ${howto.map((h) => `
            <div class="ht-step">
              <div class="ht-n">${h.n}</div>
              <div class="ht-t">${h.t}</div>
              <div class="ht-d">${h.d}</div>
            </div>`).join('')}
        </div>
      </section>

      <section class="intro-sec">
        <div class="sec-head"><span class="eyebrow">THE SIX ／ 六名住戶</span><span class="sec-note">當晚都出現在交誼廳與公共廚房附近</span></div>
        <div class="cast">
          ${DEMO.characters.map((c, i) => `
            <div class="cast-item">
              <div class="cast-photo"><img src="${MEDIA.charImg(c.key)}" alt="${c.name}"><span class="cast-no">0${i + 1}</span></div>
              <div class="cast-name">${c.name}</div>
              <div class="cast-role">${c.role}</div>
              <div class="cast-trait">${esc(c.trait)}</div>
            </div>`).join('')}
        </div>
      </section>

      <div class="now-task">
        <div><span class="nt-label">你現在知道</span><b>23:00 左右下層那一格被發現已空；巡查簿在 22:47 那一輪寫著「已檢查｜正常」。</b></div>
        <div><span class="nt-label">目前任務</span><b>${esc(DEMO.meta.task)}</b></div>
      </div>

      <div class="video-box">
        <div class="vb-head"><span class="feed-tag">SECURE FEED</span><span class="feed-name">案發紀錄｜demo 以逐字稿代替影片</span></div>
        ${DEMO.script.map((p) => `<p class="${/巡查簿|22:47/.test(p) ? 'sys' : ''}">${esc(p)}</p>`).join('')}
      </div>

      <p class="hint-line">${DEMO.meta.level}｜訓練焦點：${DEMO.meta.skills}</p>

      <div class="footer-nav">
        <span></span>
        <button class="btn" id="next0">從下層空了那一刻開始 ↗</button>
      </div>
    `;
    $('#next0').addEventListener('click', () => go(1));
  }

  function viewTestimony() {
    app().innerHTML = `
      <div class="eyebrow">PHASE 2 ／ TESTIMONY</div>
      <h2>六人發言</h2>
      <p class="hint-line">點開證詞檔案，閱讀每個人的說法。閱讀時留意：哪些是<b>親眼所見</b>，哪些是<b>自行推測</b>？</p>
      <div class="char-grid" style="margin-top:16px">
        ${DEMO.characters.map((c, i) => `
          <div class="char-card ${S.read[c.key] ? 'read' : ''}" data-k="${c.key}">
            <div class="cc-media">
              <img class="cc-photo" src="${MEDIA.charImg(c.key)}" alt="${c.name}">
              <span class="cc-tag">0${i + 1}／證詞</span>
              ${S.read[c.key] ? '<span class="cc-flag">✓ 已查證</span>' : ''}
            </div>
            <div class="cc-body">
              <div class="cc-code">SUBJ—0${i + 1}</div>
              <div class="cc-name">${c.name}</div>
              <div class="cc-role">${c.role}</div>
              <div class="cc-hook">${esc(c.trait)}</div>
              <div class="cc-cta">開啟證詞檔案 →</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="footer-nav">
        <button class="btn ghost" id="back1">← 案情</button>
        <button class="btn" id="next1">前往訊問 →</button>
      </div>
    `;
    app().querySelectorAll('.char-card').forEach((el) =>
      el.addEventListener('click', () => openTestimony(el.dataset.k)));
    $('#back1').addEventListener('click', () => go(0));
    $('#next1').addEventListener('click', () => go(2));
  }

  function openTestimony(key) {
    const c = charOf(key);
    const idx = DEMO.characters.findIndex((x) => x.key === key) + 1;
    S.read[key] = true;
    openModal(`
      <div class="modal-head">
        <div><div class="ph-title">住戶證詞研判</div><div class="ph-file">FILE NO. SUBJ—0${idx}</div></div>
        <button class="x" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="dossier-id">
          <div class="di-photo"><img src="${MEDIA.charImg(key)}" alt="${c.name}"></div>
          <div>
            <div class="di-code">SUBJ—0${idx}</div>
            <div class="di-name">${c.name}</div>
            <div class="di-verified">Identity Verified</div>
            <div class="di-role">${c.role}</div>
          </div>
        </div>
        <div class="testimony-quote">「${esc(c.testimony)}」</div>
        <div class="di-note">${esc(c.trait)}</div>
        <div class="paper-foot">Testimony on Record <span>✓</span></div>
        <p class="hint-line">— 可在下一階段「訊問」中針對這段說法提問。</p>
      </div>
    `, () => renderStep(), 'paper');
  }

  function viewInterrogation() {
    app().innerHTML = `
      <div class="eyebrow">PHASE 3 ／ INTERROGATION</div>
      <h2>訊問</h2>
      <p class="hint-line">選擇角色接通加密線路。可點<b>建議問題</b>，也可以<b>自由輸入</b>問題（demo 會比對到最接近的劇本回答）。切換上方溫度後重問同一題，即可比較兩種 AI 風格。</p>
      <div class="char-grid" style="margin-top:16px">
        ${DEMO.characters.map((c, i) => {
          const n = (S.chats[c.key] || []).filter((m) => m.who === 'me').length;
          return `
          <div class="char-card ${n ? 'read' : ''}" data-k="${c.key}">
            <div class="cc-media">
              <img class="cc-photo" src="${MEDIA.charImg(c.key)}" alt="${c.name}">
              <span class="cc-tag">0${i + 1}／訊問</span>
              ${n ? `<span class="cc-flag">通聯 ${n} 次</span>` : ''}
            </div>
            <div class="cc-body">
              <div class="cc-code">SUBJ—0${i + 1}</div>
              <div class="cc-name">${c.name}</div>
              <div class="cc-role">${c.role}</div>
              <div class="cc-hook">${esc(c.trait)}</div>
              <div class="cc-cta">接通訊問線路 →</div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="footer-nav">
        <button class="btn ghost" id="back2">← 六人證詞</button>
        <button class="btn" id="next2">前往推理判斷 →</button>
      </div>
    `;
    app().querySelectorAll('.char-card').forEach((el) =>
      el.addEventListener('click', () => openChat(el.dataset.k)));
    $('#back2').addEventListener('click', () => go(1));
    $('#next2').addEventListener('click', () => go(3));
  }

  /* ------------------------------------------------------------ 角色問答 */

  function openChat(key) {
    const c = charOf(key);
    S.activeChar = key;
    if (!S.chats[key]) S.chats[key] = [];

    openModal(`
      <div class="modal-head">
        ${avImg(key)}
        <div><div class="nm">${c.name}</div><div class="rl">${c.role}</div></div>
        <div class="call-status"><span class="dot"></span>加密線路已接通</div>
        <button class="x" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="testimony-quote">「${esc(c.testimony)}」</div>
        <div class="chat-log" id="chatLog"></div>
      </div>
      <div class="ask-area">
        <div class="chips" id="chipRow">
          ${c.questions.map((qa, i) => `<button class="chip" data-q="${i}">${esc(qa.q)}</button>`).join('')}
        </div>
        <div class="ask-row">
          <input id="chatInput" type="text" placeholder="或自由輸入你的問題…" maxlength="60">
          <button class="btn" id="chatSend">送出</button>
        </div>
      </div>
    `, () => { S.activeChar = null; renderStep(); });

    drawChat(key);

    document.querySelectorAll('#chipRow .chip').forEach((b) =>
      b.addEventListener('click', () => {
        const qa = c.questions[Number(b.dataset.q)];
        askChar(key, qa.q, pickTemp(qa));
      }));

    const send = () => {
      const inp = $('#chatInput');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      const qa = matchQuestion(c, text);
      askChar(key, text, qa ? pickTemp(qa) : pickTemp(c.fallback));
    };
    $('#chatSend').addEventListener('click', send);
    $('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function askChar(key, question, answer) {
    const log = S.chats[key];
    log.push({ who: 'me', text: question });
    drawChat(key, true);
    setTimeout(() => {
      log.push({ who: 'them', text: answer, temp: S.temp });
      drawChat(key);
    }, 700 + Math.random() * 700);
  }

  function drawChat(key, typing) {
    const el = $('#chatLog');
    if (!el) return;
    const c = charOf(key);
    el.innerHTML = S.chats[key].map((m) => m.who === 'me'
      ? `<div class="msg me"><div class="bubble">${esc(m.text)}</div></div>`
      : `<div class="msg them">
           ${avImg(key)}
           <div class="bubble"><span class="temp-chip ${m.temp}">${m.temp === 'low' ? '低溫 T≈0.2' : '高溫 T≈1.0'}</span><br>${esc(m.text)}</div>
         </div>`).join('')
      + (typing ? `<div class="msg them">${avImg(key)}<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>` : '');
    const body = el.closest('.modal-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  /* ------------------------------------------------------------ 推理判斷 */

  function viewRanking() {
    app().innerHTML = `
      <div class="eyebrow">PHASE 4 ／ JUDGEMENT</div>
      <h2>推理判斷</h2>
      <p class="hint-line">根據證詞與訊問結果，選出你認為<b>說法最不合理</b>的一個人，並寫下理由。</p>
      <div class="pick-list" style="margin-top:16px">
        ${DEMO.characters.map((c, i) => `
          <div class="pick-item ${S.pick === c.key ? 'on' : ''}" data-k="${c.key}">
            <div class="pi-num">0${i + 1}</div>
            <div class="pi-body">
              <div class="pi-name">${c.name}<span class="pi-role">${c.role}</span></div>
              <div class="pi-text">「${esc(c.testimony.slice(0, 52))}…」</div>
            </div>
            <div class="tick">${S.pick === c.key ? '✓' : ''}</div>
          </div>`).join('')}
      </div>
      <textarea class="reason" id="reasonBox" placeholder="我的理由：這個說法從哪一個觀察，跳到了哪一個結論？">${esc(S.reason)}</textarea>
      <div class="footer-nav">
        <button class="btn ghost" id="back3">← 訊問</button>
        <button class="btn" id="submitBtn" ${S.pick ? '' : 'disabled'}>送出判斷 →</button>
      </div>
    `;
    app().querySelectorAll('.pick-item').forEach((el) =>
      el.addEventListener('click', () => {
        S.pick = el.dataset.k;
        S.reason = $('#reasonBox').value;
        viewRanking();
      }));
    $('#reasonBox').addEventListener('input', (e) => { S.reason = e.target.value; });
    $('#back3').addEventListener('click', () => go(2));
    $('#submitBtn').addEventListener('click', () => { S.submitted = true; go(4); });
  }

  /* ---------------------------------------------------------------- 回饋 */

  function viewFeedback() {
    if (!S.submitted && !S.pick) {
      app().innerHTML = `
        <div class="eyebrow">PHASE 5 ／ FEEDBACK</div>
        <h2>回饋</h2>
        <div class="card dim">請先完成「推理判斷」並送出，才會產生回饋。</div>
        <div class="footer-nav"><button class="btn ghost" id="backF">← 前往推理判斷</button><span></span></div>
      `;
      $('#backF').addEventListener('click', () => go(3));
      return;
    }

    /* 控制組：只確認收到作答，不給任何 AI 回饋 */
    if (S.group === 'ctrl') {
      app().innerHTML = `
        <div class="eyebrow">PHASE 5 ／ FEEDBACK（控制組）</div>
        <div class="card control-done">
          <div class="big">📮</div>
          <h2>作答已送出</h2>
          <p class="hint-line">${esc(DEMO.feedback.controlMessage)}</p>
          <p class="hint-line" style="margin-top:16px">（demo 說明：控制組看不到 AI 瑕疵判斷與批判思考引導——這就是實驗操弄的差異。可用上方切回「實驗組」比較。）</p>
          <div style="margin-top:18px"><button class="btn" disabled>前往下一關（demo 僅一關）</button></div>
        </div>
      `;
      return;
    }

    /* 實驗組：AI 逐一判斷瑕疵 + 批判思考引導 */
    const picked = charOf(S.pick);
    const hit = picked && picked.verdict === 'flaw';
    app().innerHTML = `
      <div class="eyebrow">PHASE 5 ／ FEEDBACK（實驗組・${tempLabel()}）</div>
      <h2>AI 批判思考回饋</h2>

      <div class="card ai-card">
        <div class="vb-head" style="border-left:0;padding-left:0;margin-bottom:8px"><span class="feed-tag">AI GUIDE</span><span class="feed-name">批判思考引導</span></div>
        ${esc(pickTemp(DEMO.feedback.opening))}
      </div>

      <div class="pick-result ${hit ? 'hit' : 'miss'}">
        你選出的最不合理說法：<b>${picked.name}</b><br>
        ${hit
          ? (S.temp === 'low'
              ? 'AI 判定：正確。此說法確實含有推論瑕疵，詳見下方分析。'
              : '答對了！👏 這個說法真的有問題，往下看 AI 幫你拆解～')
          : (S.temp === 'low'
              ? 'AI 判定：此說法屬於合理陳述。含有瑕疵的說法請見下方標示，並對照你原本的判斷依據。'
              : '嗯～其實這位的說法是站得住腳的喔 🤔 有瑕疵的另有其人，往下看你就知道哪裡被帶偏了！')}
        ${S.reason ? `<div class="fb-quote">你的理由：「${esc(S.reason)}」</div>` : ''}
      </div>

      <h2 style="margin-top:22px">六人說法逐一檢視</h2>
      ${DEMO.characters.map((c, i) => `
        <div class="fb-item ${c.verdict}">
          <div class="char-head">
            ${avImg(c.key)}
            <div><div class="nm">${c.name}<span style="font-family:var(--font-en);font-size:10px;letter-spacing:.25em;color:var(--text-dim);margin-left:10px">SUBJ—0${i + 1}</span></div><div class="rl">${c.role}</div></div>
          </div>
          <div class="fb-quote">「${esc(c.testimony)}」</div>
          <div class="fb-verdict">${esc(pickTemp(DEMO.feedback.perVerdict[c.verdict]))}</div>
          <div class="fb-crit">${esc(c.criterion)}</div>
        </div>`).join('')}

      <div class="card ai-card">
        <div class="vb-head" style="border-left:0;padding-left:0;margin-bottom:8px"><span class="feed-tag">AI DEBRIEF</span><span class="feed-name">總結研判</span></div>
        ${esc(pickTemp(DEMO.feedback.conclusion))}
      </div>

      <div class="footer-nav">
        <button class="btn ghost" id="back4">← 回推理判斷</button>
        <button class="btn" disabled>前往下一關（demo 僅一關）</button>
      </div>
    `;
    $('#back4').addEventListener('click', () => go(3));
  }

  /* ---------------------------------------------------------------- Modal */

  let modalCloseCb = null;

  function openModal(innerHtml, onClose, cls) {
    closeModal();
    modalCloseCb = onClose || null;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = 'modalMask';
    mask.innerHTML = `<div class="modal${cls ? ' ' + cls : ''}">${innerHtml}</div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(true); });
    mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(true)));
  }

  function closeModal(fire) {
    const m = $('#modalMask');
    if (m) m.remove();
    if (fire && modalCloseCb) { const cb = modalCloseCb; modalCloseCb = null; cb(); }
  }

  /* ------------------------------------------------------- 右下角小助手 */

  function renderBot() {
    const root = $('#botRoot');
    const A = DEMO.assistant;
    if (!S.botOpen) {
      root.innerHTML = `
        <button class="bot-fab" id="botFab" title="思考助手"><img src="${MEDIA.bot}" alt="思考助手">${S.botSeen ? '' : '<span class="badge"></span>'}</button>`;
      $('#botFab').addEventListener('click', () => {
        S.botOpen = true;
        S.botSeen = true;
        if (!S.botLog.length) S.botLog.push({ who: 'them', text: pickTemp(A.greeting), temp: S.temp });
        renderBot();
      });
      return;
    }

    root.innerHTML = `
      <div class="bot-panel">
        <div class="bot-head">
          <div class="b-avatar"><img src="${MEDIA.bot}" alt=""></div>
          <div><div class="nm">思考助手・${A.name}</div><div class="st">不會給答案，只給思考方向｜${tempLabel()}</div></div>
          <button class="x" id="botClose">×</button>
        </div>
        <div class="bot-log" id="botLog"></div>
        <div class="bot-input">
          <div class="quick">
            <button class="chip" id="botHint">💡 給我一點提示</button>
            <button class="chip" id="botHow">🔍 怎麼找瑕疵？</button>
          </div>
          <div class="ask-row">
            <input id="botInput" type="text" placeholder="問小燈任何問題…" maxlength="60">
            <button class="btn" id="botSend">送出</button>
          </div>
        </div>
      </div>
      <button class="bot-fab" id="botFab"><img src="${MEDIA.bot}" alt="思考助手"></button>
    `;
    drawBot();
    $('#botClose').addEventListener('click', () => { S.botOpen = false; renderBot(); });
    $('#botFab').addEventListener('click', () => { S.botOpen = false; renderBot(); });

    $('#botHint').addEventListener('click', () => {
      const phaseKey = STEPS[S.step].key;
      botAsk('給我一點提示', pickTemp(A.phaseHints[phaseKey]));
    });
    $('#botHow').addEventListener('click', () => {
      const kw = A.keywords.find((k) => k.match.includes('瑕疵'));
      botAsk('怎麼找瑕疵？', pickTemp(kw));
    });

    const send = () => {
      const inp = $('#botInput');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      const kw = A.keywords.find((k) => k.match.some((m) => text.includes(m)));
      botAsk(text, kw ? pickTemp(kw) : pickTemp(A.fallback));
    };
    $('#botSend').addEventListener('click', send);
    $('#botInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function botAsk(q, a) {
    S.botLog.push({ who: 'me', text: q });
    drawBot(true);
    setTimeout(() => {
      S.botLog.push({ who: 'them', text: a, temp: S.temp });
      drawBot();
    }, 600 + Math.random() * 600);
  }

  function drawBot(typing) {
    const el = $('#botLog');
    if (!el) return;
    el.innerHTML = S.botLog.map((m) => m.who === 'me'
      ? `<div class="msg me"><div class="bubble">${esc(m.text)}</div></div>`
      : `<div class="msg them">
           <img class="avatar photo" src="${MEDIA.bot}" alt="">
           <div class="bubble"><span class="temp-chip ${m.temp}">${m.temp === 'low' ? '低溫 T≈0.2' : '高溫 T≈1.0'}</span><br>${esc(m.text)}</div>
         </div>`).join('')
      + (typing ? `<div class="msg them"><img class="avatar photo" src="${MEDIA.bot}" alt=""><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>` : '');
    el.scrollTop = el.scrollHeight;
  }

  /* ---------------------------------------------------------------- 啟動 */

  /* URL 參數可直接跳到特定情境，方便簡報與測試：
     ?temp=high&group=ctrl&step=4&pick=3&chat=4&bot=1 */
  (function initFromUrl() {
    const qp = new URLSearchParams(location.search);
    if (['low', 'high'].includes(qp.get('temp'))) S.temp = qp.get('temp');
    if (['exp', 'ctrl'].includes(qp.get('group'))) S.group = qp.get('group');
    if (qp.get('pick') && charOf(qp.get('pick'))) { S.pick = qp.get('pick'); S.submitted = true; }
    const st = Number(qp.get('step'));
    if (st >= 1 && st <= STEPS.length) S.step = st - 1;
    S._openChat = charOf(qp.get('chat')) ? qp.get('chat') : null;
    S._openBot = qp.get('bot') === '1';
  })();

  renderBar();
  renderStepper();
  renderStep();
  renderBot();

  if (S._openChat) {
    openChat(S._openChat);
    const c = charOf(S._openChat);
    askChar(S._openChat, c.questions[0].q, pickTemp(c.questions[0]));
  }
  if (S._openBot) {
    S.botOpen = true;
    S.botSeen = true;
    if (!S.botLog.length) S.botLog.push({ who: 'them', text: pickTemp(DEMO.assistant.greeting), temp: S.temp });
    renderBot();
    botAsk('給我一點提示', pickTemp(DEMO.assistant.phaseHints[STEPS[S.step].key]));
  }
})();
