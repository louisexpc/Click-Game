// === 主畫面設定 ===
const canvas = document.getElementById("main-screen");
const ctx = canvas.getContext("2d");

const w = canvas.width = 800 ;
const h = canvas.height = 800 ;

const rect = canvas.getBoundingClientRect()

const imgWidth = 50;
const imgHeight = 50;

// === 副畫面設定 ===
const sideCanvas = document.getElementById("side-screen");
const sideCtx = sideCanvas.getContext("2d");

let sideW = sideCanvas.width = 800;
let sideH = sideCanvas.height = 300;

// === 設定成就 ===
let gameStartTime = null;
let achievements = [
  {
    title: "Max Score 100",
    achieved: false,
    achieved_time: null,
    condition : (gameManager) => gameManager.score >= 100
  },
  {
    title: "Max Score 1000",
    achieved: false,
    achieved_time: null,
    condition: (gameManager) => gameManager.score >= 1000
  },
  {
    title: "Max Score 10000",
    achieved: false,
    achieved_time: null,
    condition: (gameManager) => gameManager.score >= 10000
  },
  {
    title: "Have 5 Jerrys",
    achieved: false,
    achieved_time: null,
    condition: (gameManager) => gameManager.objects.jerrys.length >= 5
  },
  {
    title: "Have 10 Jerrys",
    achieved: false,
    achieved_time: null,
    condition: (gameManager) => gameManager.objects.jerrys.length >= 10
  },
];

// === 讀取 Config ===

let charCfgMap = {};               
(async function initConfig () {
  const cfgArr = await fetch("./static/config.json").then(r => r.json());

  /* 轉成物件，並預載圖片；並把 actionX.img 指向同一個 Image */
  charCfgMap = Object.fromEntries(
    cfgArr.map(cfg => {
      const img = new Image();
      img.src = "./static/" + cfg.img;

      // assign image reference to nested animations if they exist
      if (cfg.action1) cfg.action1.img = img;
      if (cfg.action2) cfg.action2.img = img;
      if (cfg.action) cfg.action = cfg.action || null; // safe guard

      // 回傳時把 img 放到主 cfg 裡（展開原 cfg）
      return [cfg.type, { ...cfg, img }];
    })
  );

  // 選擇性： 等所有 image load 完再 start（避免畫面空白或 race）
  await Promise.all(Object.values(charCfgMap).map(c => {
    return new Promise(resolve => {
      if (!c.img) return resolve();
      if (c.img.complete) return resolve();
      c.img.onload = () => resolve();
      c.img.onerror = () => resolve(); // 失敗也繼續
    });
  }));
  gameStartTime = Date.now(); // 遊戲開始時間
  renderAchievements();              // 預先渲染成就面板
  startGame();                      // cfg 到手且圖 (大致) 載入後才真正啟動
})();




// === Sprite Sheet 管理 ===

class SpriteManager {
  constructor(cfg,mode) {
    /*New Added*/
    this.cfg = cfg;
    this.img = cfg.img;
    this.sx = cfg.sx;
    this.sy =  cfg.sy;
    this.width = cfg.width;
    this.height = cfg.height;
    this.frameCount = cfg.frameCount;
    this.frameDuration = cfg.frameDuration;

    this.frameIndex = 0;
    this.nextFrame = Date.now() + this.frameDuration;
    this.mode = mode; // "main" or "side"

  }
  drawSprite(x,y) {
    if(Date.now() >= this.nextFrame){
        this.frameIndex = (this.frameIndex+1) % this.frameCount;
        this.nextFrame = Date.now() + this.frameDuration
    }
    if(this.mode==="main"){
        if("range_w" in this.cfg){
          /*For Weapons*/
          ctx.drawImage(this.img,this.sx + this.width * this.frameIndex,this.sy,this.width,this.height,x,y,this.cfg.range_w,this.cfg.range_h)
        }else{
            ctx.drawImage(this.img,this.sx + this.width * this.frameIndex,this.sy,this.width,this.height,x,y,imgWidth,imgHeight);
        }
    }else{
      sideCtx.drawImage(this.img,this.sx + this.width * this.frameIndex,this.sy,this.width,this.height,x,y,imgWidth,imgHeight);
    }

    
  }
}
// === Template ===
class BasicWeapons {
  constructor(cfg, gameManager) {
    this.width = cfg.width;
    this.type = cfg.type
    this.height = cfg.height;
    this.range_w = cfg.range_w; // 攻擊範圍寬
    this.range_h = cfg.range_h; // 攻擊範圍高

    this.pos = this.randMove(); // 目前顯示/判定中心
    this._pendingPos = null;    // FIX: 用來暫存下一輪要移動到的位置（避免「一觸發就換位置」）

    this.gameManager = gameManager;
    this.spriteManager = new SpriteManager(cfg,"main");

    this.actionInterval = cfg.actionInterval;
    this.nextAction = Date.now() + this.actionInterval;

    this.flashDuration = Math.min(
      cfg.flashDuration ?? 800,
      Math.max(0, this.actionInterval - 16) // 確保 < nextAction
    );
    this.visibleUntil = 0; // 顯示窗口結束時間（0 = 不顯示）
  }

  /** 只在達到觸發時間時執行一次 */
  action() {
    const now = Date.now();
    if (now < this.nextAction) return false;

    // 計算攻擊範圍內的 Jerry 數（FIX: 原本 count=1，會忽略多隻；改為累加）
    let count = 0;
    const x1 = this.pos.x, y1 = this.pos.y;
    const x2 = x1 + this.range_w, y2 = y1 + this.range_h;

    this.gameManager.objects.jerrys.forEach(j => {
      // FIX: 原本只用 jerry.pos（左上角）是否落在範圍內；
      // 若要更嚴謹，可做矩形重疊，這裡先保留點擊器邏輯：以頭部/左上為基準
      const jx = j.pos.x, jy = j.pos.y;
      if (jx >= x1 && jx <= x2 && jy >= y1 && jy <= y2) {
        count += 1;
      }
    });

    // 計分（若 Jerry reward 可能未載入，做容錯）
    const per = (charCfgMap["Jerry"]?.reward ?? 0);
    if (count > 0) {
      this.gameManager.score += count * per;
      // FIX: 若你的 UI 不會每幀更新，這邊順手刷新（避免加分看不到）
      this.gameManager.updateBoard?.();
    }

    // 設定可見窗，開始顯示動畫
    this.visibleUntil = now + this.flashDuration;

    // 下一輪時間：等 flash 播完到下一個觸發點之間的時間會是「冷卻期」
    this.nextAction = now + this.actionInterval;

    // FIX: 不要立刻換位置，否則會出現「剛觸發就瞬移」，
    // 先算好下一個位置，等顯示窗結束後再切換。
    this._pendingPos = this.randMove();

    addLog(`${this.type} 抓到了 ${count} 隻 Jerry`)

    return true;
  }

  draw() {
    const now = Date.now();

    // 1) 先嘗試觸發（只有到點才會做事，不會每幀加分）
    this.action();

    // 2) 顯示窗內才畫（避免一閃而過）
    if (now <= this.visibleUntil) {
      this.spriteManager.drawSprite(this.pos.x, this.pos.y);
    } else {
      // 3) 顯示窗結束 → 冷卻期：這時機才換到下一個位置（FIX: 避免觸發當下就跳）
      if (this._pendingPos) {
        this.pos = this._pendingPos;
        this._pendingPos = null;
      }
      // 也可以在冷卻期畫半透明提示框（可選）
      // ctx.save();
      // ctx.globalAlpha = 0.15;
      // ctx.fillStyle = '#f0f';
      // ctx.fillRect(this.pos.x, this.pos.y, this.range_w, this.range_h);
      // ctx.restore();
    }
  }

  randMove() {
    // FIX: 若 range 超出畫面要避免負數造成 NaN
    const maxX = Math.max(0, w - (this.width + this.range_w));
    const maxY = Math.max(0, h - (this.height + this.range_h));
    return {
      x: Math.random() * maxX,
      y: Math.random() * maxY,
    };
  }

  upgrade() {
    // TODO: 依你的升級規則調整 actionInterval / range / flashDuration ...
  }
}


class BasicJerrys{
    constructor(cfg){
        
        this.reward=cfg.reward; //reward:"pts/click"//

        this.moveInterval = cfg.moveInterval; // Jerrys 的移動間隔
        this.nextMove = Date.now() + this.moveInterval;

        this.width = cfg.width; // Jerrys 的圖片範圍
        this.height = cfg.height; // Jerrys 的圖片範圍
        this.pos = this.randMove();
        this.spriteManager = new SpriteManager(cfg,"main");
    }

    randMove(){
        return {
            x : Math.random()*(w-this.width),
            y :Math.random()*(h-this.height),
        }
    }

    action(){

    }

    draw(){
        if (Date.now()>this.nextMove){
            this.pos = this.randMove();
            this.nextMove = Date.now() + this.moveInterval;
        }
        this.spriteManager.drawSprite(this.pos.x, this.pos.y);
    }

    isHit(clickPos) {
        return (clickPos.x >= this.pos.x && clickPos.x <= this.pos.x + this.width &&
               clickPos.y >= this.pos.y && clickPos.y <= this.pos.y + this.height);
    }

    upgrade(){

    }
}

class Tom{
    constructor(cfg,gameManager){
        this.cfg = cfg;
        this.spriteManager = new SpriteManager(cfg,"side");
        this.width = cfg.width;
        this.height = cfg.height;
        this.gameManager = gameManager;
        this.idx = gameManager.objects.toms.length; // 依照目前 Tom 的數量決定位置
       
        this.pos = {
          x: this.idx * imgWidth,
          y: 0
        }

    } 

    draw(){
        this.spriteManager.drawSprite(this.pos.x, this.pos.y);
    }

}
class Dog{
  constructor(cfg,gameManager){
    this.cfg = cfg;
    this.type = cfg.type;
    this.gameManager = gameManager;
    //action
    this.actionInterval = cfg.actionInterval;
    this.gainPoint = cfg.gainPoint;
    this.consumeBones = cfg.consumeBones;
    this.totalBones = 0;
    this.currentAction = "action1";
    this.nextAction = Date.now() + this.actionInterval;

    // Draw
    this.width = cfg.action2.width;

    this.spriteManagers = {};
    ["action1", "action2"].forEach(name => {
      if (cfg[name]) {
        // cfg[name].img 必須為 Image instance（可從 charCfgMap 取得）
        this.spriteManagers[name] = new SpriteManager(cfg[name], "side");
      }
    });

    // Pos:
    this.idx = gameManager.objects.dogs.length; // 依照目前 Dog 的數量決定位置

    this.pos = {
      x: this.idx * this.width,
      y: sideH/2
    };

  }

    // 切換狀態（會重置動畫）
  setAction(name) {
    if (this.currentAction === name) return;
    this.currentAction = name;
    const sm = this.spriteManagers[name];
    if (sm) {
      sm.frameIndex = 0;
      sm.nextFrame = Date.now() + sm.frameDuration;
      this.draw(); 
    }
  }

  action(){
    if(Date.now() > this.nextAction){
      this.nextAction = Date.now() + this.actionInterval;

      if(this.totalBones >= this.consumeBones){
        this.gameManager.score += this.gainPoint;
        this.totalBones -= this.consumeBones;
        this.setAction("action1");
        render(this.gameManager, charCfgMap);
        addLog(`${this.type} 吃了 ${this.consumeBones} 骨頭，產生了 ${this.gainPoint} 分`);
        this.gameManager.updateBoard();
      }else{
        this.setAction("action2");
        addLog(`${this.type} 沒有足夠的骨頭，Spike 開始生氣了!!!`);
      }
    }
  }

  draw(){
    this.action(); // 每幀都嘗試觸發行為

    const sm = this.spriteManagers[this.currentAction];
    if (sm) {
      sm.drawSprite(this.pos.x, this.pos.y);
    } else {
      // fallback：若沒 animation，畫單張圖（cfg.img 應該是 Image）
      if (this.cfg.img) ctx.drawImage(this.cfg.img, this.pos.x, this.pos.y);
    }
  }
}
class GameManager{
    constructor(){
        this.score=0;
        this.objects = {
            jerrys : [ new BasicJerrys(charCfgMap["Jerry"]) ], // ← 用字串 key
            traps  : [],
            grandmas : [],
            godzillas : [],
            bartsimpsons : [],
            toms : [],
            dogs : []
        };


        this.clickPos={
            x:0,
            y:0,
        };
        /*Init Upgrade Panel*/
        render(this, charCfgMap);

        /*Register Event*/
        canvas.addEventListener("click",(e)=>{
            this.clickPos = this.clickCorrd(e);
            // Click Jerrys
            let isClick = false;
            this.objects.jerrys.forEach(jerry=>{
                if(jerry.isHit(this.clickPos)){
                    this.score+=jerry.reward;
                    this.updateBoard();
                    isClick = true;
                    addLog(` 點中了 Jerry！ (${this.clickPos.x.toFixed(0)},${this.clickPos.y.toFixed(0)})`);
                }
            })

            if(!isClick) {
              addLog(`沒點中 Jerry ! (${this.clickPos.x.toFixed(0)},${this.clickPos.y.toFixed(0)})`);
            }
            // Click Traps
            this.objects.traps.forEach(trap=>{
              if(trap.isHit(this.clickPos)){
                this.score = this.score * (trap.reward / (-100));
                addLog(`點中了 Trap HAHA！ (${this.clickPos.x.toFixed(0)},${this.clickPos.y.toFixed(0)})`);
                this.updateBoard();
              }
            })
            
        })

        this.gameLoop = () => {
            ctx.clearRect(0, 0, w, h);
            sideCtx.clearRect(0, 0, sideW, sideH);

            /* Characters Actions */
            Object.entries(this.objects).forEach(([key,objArrs])=>{
              objArrs.forEach(obj=>{
                obj.draw();
              })
            })

            
            requestAnimationFrame(this.gameLoop);
        };

        this.gameLoop();

    }

    clickCorrd(event){
        // 每次點擊即時抓最新的 bounding rect
        const rect = canvas.getBoundingClientRect();

        // 考慮螢幕縮放或 CSS 縮放，轉成真正的 canvas 座標
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;

        const logicX = (event.clientX - rect.left) * scaleX;
        const logicY = (event.clientY - rect.top)  * scaleY;

        return {x:logicX,y:logicY};
        
    }

    updateBoard(){
        const scoreBoard = document.getElementById("score");
        scoreBoard.textContent = this.score;
        updateAchievementPanel(this);
    }



}

// === Upgrader Pannel ===
function render(gameManager,configMap){
    const panelElem = document.getElementById('upgrade-panel');
    const container = document.getElementById("character-upgrade-list"); 

    container.innerHTML = ""; // FIX: 重新渲染時先清空，避免重複生成

    Object.entries(configMap).forEach(([type, cfg]) => {
        if(type === "Trap") return; // Trap 不顯示在面板上
        const div = document.createElement("div");

        div.id = `char-${type}`;
        div.classList.add("character-panel");

        const header = document.createElement("h3");
        header.textContent = type;
        div.appendChild(header);

        if (cfg.unlock) {
            // 已解鎖：顯示升級選項
            if(type !== "Trap" ){
              
              const upgradeList = document.createElement("ul");
              Object.entries(cfg.upgradeInfo).forEach(([key, upgradeCfg]) => { // key: addAmount, upgradeCfg: {desc:"xxx",price:100...etc}
                  const li = document.createElement("li");
                  li.textContent = `${upgradeCfg.desc} $${upgradeCfg.price}`;
                  const btn = document.createElement("button");
                  btn.textContent = key;

                  btn.onclick = () => {
                      const upgradeFunc = findUpgradeFunc(type);
                      if (upgradeFunc) {
                          upgradeFunc(gameManager, key);
                          gameManager.updateBoard();
                      }
                  };
                  li.appendChild(btn);
                  upgradeList.appendChild(li);

              });
              if(type === "Dog"){
                const liInfo = document.createElement("li");
                const dog = gameManager.objects.dogs[0];
                liInfo.textContent = `Total Bones You Have: ${dog.totalBones}, Bone Consume per ${(dog.actionInterval/1000).toFixed(1)}s : ${dog.consumeBones}`;
                upgradeList.appendChild(liInfo);
              }
              div.appendChild(upgradeList);
            }
            
        } else {
            //TODO:  未解鎖：顯示解鎖按鈕
            const unlockBtn = document.createElement("button");
            unlockBtn.textContent = "解鎖角色";
            unlockBtn.onclick = () => {
                const upgradeFunc = findUpgradeFunc(type);
                if (upgradeFunc){
                    upgradeFunc(gameManager,"unlock");
                    gameManager.updateBoard();
                }
            };
            div.appendChild(unlockBtn);
        }

        container.appendChild(div);
    });
}

function upgradeJerry(gameManager, key){
    switch(key){
        case "addAmount":
            let price = charCfgMap['Jerry'].upgradeInfo.addAmount.price;
            if(gameManager.score >= price){
                const rand = Math.random();
                if(rand >=0.5){ // 75% 生成 Jerry
                  gameManager.objects.jerrys.push(new BasicJerrys(charCfgMap['Jerry']));
                  addLog("運氣不錯，生成 Jerry ");
                  
                }else{
                  gameManager.objects.traps.push(new Trap(charCfgMap['Trap']));
                  addLog("運氣不好，生成 Trap ");
                }
                gameManager.score-=price;
                charCfgMap['Jerry'].upgradeInfo.addAmount.price = Math.round(price * charCfgMap['Jerry'].upgradeInfo.addAmount.priceFactor);
                render(gameManager, charCfgMap)

            }
            break;
    }
}
function upgradeGrandma(gameManager, key){
    let gconfig=charCfgMap["Grandma"];
    switch(key){
        case "reduceCD":
            if(gameManager.score>=gconfig.upgradeInfo.reduceCD.price){
                gameManager.score-=gconfig.upgradeInfo.reduceCD.price;
                gconfig.upgradeInfo.reduceCD.price=Math.floor(gconfig.upgradeInfo.reduceCD.price*gconfig.upgradeInfo.reduceCD.priceFactor)
                gconfig.actionInterval=Math.floor(gconfig.actionInterval*0.95);
                if(gconfig.flashDuration>gconfig.actionInterval){
                    gconfig.flashDuration=gconfig.actionInterval;
                }
                gameManager.updateBoard();
                render(gameManager,charCfgMap);

                let total=gameManager.objects.grandmas.length;
                gameManager.objects.grandmas=[];

                for(let i=0; i<total; i++){
                    gameManager.objects.grandmas.push(new BasicWeapons(charCfgMap["Grandma"],gameManager));
                }
                addLog(`Grandma upgrade reduceCD sucess: ${gconfig.actionInterval}`);
            }
            break;

        case "unlock":
            if(gameManager.score>=gconfig.unlockPrice&&gconfig.unlock==false){
                charCfgMap["Grandma"].unlock = true; // 標記為已解鎖
                gameManager.objects.grandmas.push(new BasicWeapons(charCfgMap["Grandma"], gameManager)); // FIX: 解鎖時真的生成
                gameManager.score-=gconfig.unlockPrice;
                render(gameManager, charCfgMap); // FIX: 重新渲染面板，顯示升級選項
                gameManager.updateBoard();
                addLog(`Grandma unlock success`);
            }
            break;
    }
}
function upgradeGodzilla(gameManager, key){
  let config=charCfgMap["Godzilla"];
  switch(key){
    case "unlock":
      if(gameManager.score>=config.unlockPrice&&config.unlock==false){
          config.unlock = true; // 標記為已解鎖
          gameManager.objects.godzillas.push(new Godzilla(config, gameManager)); // FIX: 解鎖時真的生成
          gameManager.score-=config.unlockPrice;
          render(gameManager, charCfgMap); // FIX: 重新渲染面板，顯示升級選項
          gameManager.updateBoard();
          addLog(`Godzilla unlock success`);
      }
      break;
    case "buyOne":
        if(gameManager.score>=config.upgradeInfo.buyOne.price){
            gameManager.score-=config.upgradeInfo.buyOne.price;
            config.upgradeInfo.buyOne.price= Math.floor(config.upgradeInfo.buyOne.price*config.upgradeInfo.buyOne.priceFactor);
            if(gameManager.objects.godzillas.length>=1){
                gameManager.objects.godzillas.pop();
            }
            gameManager.objects.godzillas.push(new Godzilla(CONFIG["Godzilla"],gameManager));
            gameManager.updateBoard();
            render(gameManager,charCfgMap);
            addLog(`Buy One Godzilla success`);
        }
        break;
    case "increaseRange":
        if(gameManager.score>=config.upgradeInfo.increaseRange.price){
            gameManager.score-=config.upgradeInfo.increaseRange.price;
            config.upgradeInfo.increaseRange.price= Math.floor(config.upgradeInfo.increaseRange.price*config.upgradeInfo.increaseRange.priceFactor);
            config.range_h=Math.floor(config.range_h*1.05);
            gameManager.updateBoard();
            render(gameManager,charCfgMap);
            addLog(`Godzilla increaseRange success: ${config.range_h}`);
        }

  }
}

function upgradeBartSimpson(gameManager,key){
    let config=charCfgMap["Bart_Simpson"];

    switch(key){
        case "unlock":
            if(gameManager.score>=config.unlockPrice&&config.unlock==false){
                charCfgMap["Bart_Simpson"].unlock=true;
                gameManager.objects.bartsimpsons.push(new Bartsimpson(charCfgMap["Bart_Simpson"],gameManager));
                gameManager.score-=config.unlockPrice;
                gameManager.updateBoard();
                render(gameManager,charCfgMap);
                addLog(`Bart_Simpson Unlock`);
            }
            break;
        case "buyOne":
            if(gameManager.score>=config.upgradeInfo.buyOne.price){
                gameManager.score-=config.upgradeInfo.buyOne.price;
                config.upgradeInfo.buyOne.price= Math.floor(config.upgradeInfo.buyOne.price*config.upgradeInfo.buyOne.priceFactor);
                if(gameManager.objects.bartsimpsons.length>=1){
                    gameManager.objects.bartsimpsons.pop();
                }
                gameManager.objects.bartsimpsons.push(new Bartsimpson(charCfgMap["Bart_Simpson"],gameManager));
                gameManager.updateBoard();
                render(gameManager,charCfgMap);
                addLog(`Buy One Godzilla success`);
            }
            break;
    }
}
function upgradeTom(gameManager, key){
    let config=charCfgMap["Tom"];

    switch(key){
        case "unlock":
            if(gameManager.score>=config.unlockPrice&&config.unlock==false){
                charCfgMap["Tom"].unlock=true;
                gameManager.objects.toms.push(new Tom(charCfgMap["Tom"],gameManager));
                gameManager.score-=config.unlockPrice;
                gameManager.updateBoard();
                render(gameManager,charCfgMap);
       

                charCfgMap['Jerry'].reward = Math.floor(charCfgMap['Jerry'].reward * 1.5); // 解鎖 Tom 後，Jerry 獎勵提升
                const totalJerry = gameManager.objects.jerrys.length;
                gameManager.objects.jerrys = [];
                for (let i = 0; i < totalJerry; i++) {
                    gameManager.objects.jerrys.push(new BasicJerrys(charCfgMap['Jerry']));
                }
                addLog(`Tom Unlock Success`);
            }
            break;
        case "buyOne":
            if(gameManager.score>=config.upgradeInfo.buyOne.price){
                gameManager.score-=config.upgradeInfo.buyOne.price;
                config.upgradeInfo.buyOne.price= Math.floor(config.upgradeInfo.buyOne.price*config.upgradeInfo.buyOne.priceFactor);

                gameManager.objects.toms.push(new Tom(charCfgMap["Tom"],gameManager));
                gameManager.updateBoard();
                render(gameManager,charCfgMap);
                charCfgMap['Jerry'].reward = Math.floor(charCfgMap['Jerry'].reward * 1.5); // 解鎖 Tom 後，Jerry 獎勵提升
                const totalJerry = gameManager.objects.jerrys.length;
                gameManager.objects.jerrys = [];
                for (let i = 0; i < totalJerry; i++) {
                    gameManager.objects.jerrys.push(new BasicJerrys(charCfgMap['Jerry']));
                }
                addLog(`Buy One Tom success`);
            }
            break;
    }
}

function upgradeDog(gameManager, key){
    let config=charCfgMap["Dog"];
    switch(key){
        case "unlock":
            if(gameManager.score>=config.unlockPrice&&config.unlock==false){
                charCfgMap["Dog"].unlock=true;
                gameManager.objects.dogs.push(new Dog(charCfgMap["Dog"],gameManager));
                gameManager.score-=config.unlockPrice;
                gameManager.updateBoard();
                render(gameManager,charCfgMap);
                addLog(`Dog Unlock`);
            }
            break;
        case "buyBones":
            if(gameManager.score>=config.upgradeInfo.buyBones.price){
                gameManager.score-=config.upgradeInfo.buyBones.price;
                gameManager.objects.dogs[0].totalBones += config.upgradeInfo.buyBones.amount;

                gameManager.updateBoard();
                render(gameManager,charCfgMap);
                addLog(`Dog Buy Bones success, current bones: ${gameManager.objects.dogs[0].totalBones}`);
            }
            break;
        case "upgrade":
            if(gameManager.score>=config.upgradeInfo.upgrade.price){
                gameManager.score-=config.upgradeInfo.upgrade.price;
                config.upgradeInfo.upgrade.price= Math.floor(config.upgradeInfo.upgrade.price*config.upgradeInfo.upgrade.priceFactor);

                config.actionInterval = Math.floor(config.actionInterval * (1 - config.upgradeInfo.upgrade.ratio));
                config.gainPoint = Math.floor(config.gainPoint * (1 + config.upgradeInfo.upgrade.ratio+ 0.2));
                config.consumeBones = Math.floor(config.consumeBones * (1 + config.upgradeInfo.upgrade.ratio));

                config.upgradeInfo.buyBones.price = Math.floor(config.upgradeInfo.buyBones.price * (1 + config.upgradeInfo.upgrade.ratio));
                config.upgradeInfo.buyBones.amount = Math.floor(config.upgradeInfo.buyBones.amount * (1 + config.upgradeInfo.upgrade.ratio));
                // 重新生成 Dog 物件以應用新配置
                gameManager.objects.dogs.pop();
                gameManager.objects.dogs.push(new Dog(charCfgMap["Dog"], gameManager));
                gameManager.updateBoard();
                render(gameManager,charCfgMap);
                addLog(`Dog Upgrade success`);
            }
            break;
    }
}

function findUpgradeFunc(type){
    switch(type){
        case "Jerry":
            return upgradeJerry;
        case "Grandma":
            return upgradeGrandma;
        case "Godzilla":
            return upgradeGodzilla;
        case "Bart_Simpson":
            return upgradeBartSimpson;
        case "Tom":
            return upgradeTom;
        case "Dog":
            return upgradeDog;
    }
}

// === Extension Characters ===
class Trap extends BasicJerrys{
  constructor(config,gameManager){
    super(config);

  }
}
class Godzilla extends BasicWeapons{
    constructor(config,gameManager){
        super(config,gameManager);
        this.usedtime=0;
        this.limit=config.limit;
        this.valid=true;
        
        if(this.range_w!=w){
            this.range_w=w;
        }
    }

  action() {
      if (!this.valid) return;

      // FIX: 必須「呼叫」父類行為；回傳 true 代表本次有觸發
      const triggered = super.action();
      if (triggered) {
        this.usedtime++;
        addLog(`${this.type} shows up!, remaining times ${this.limit-this.usedtime}`);
        if (this.usedtime >= this.limit) {
          this.valid = false;
        }
      }
    }
}

class Bartsimpson extends Godzilla{
    constructor(config,gameManager){
        super(config,gameManager);
        config.range_w=w;
        config.range_h=h;

        this.rangew=w;
        this.rangeh=h;

    }
}

function addLog(msg) {
  const logDiv = document.getElementById("log-panel");
  const entry = document.createElement("div");
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logDiv.appendChild(entry);

  // ★ 自動捲到最底
  logDiv.scrollTop = logDiv.scrollHeight;
}

// === Achievement Panel ===
function renderAchievements() {

  const panelElem = document.getElementById('achievement-panel');
  panelElem.innerHTML = "";

  achievements.forEach(ach => { // ach = {title:"Max Score 100", achieved: false, achieved_time: null}
    const achDiv = document.createElement("div");
    if (ach.achieved) {
      const elapsedMs = ach.achieved_time - gameStartTime;
      const elapsedSec = Math.floor(elapsedMs / 1000); // 換算成秒
      const elapsedMin = Math.floor(elapsedSec / 60);
      const secRemain = elapsedSec % 60;
      
      achDiv.textContent = `${ach.title} : 已達成 (耗時 ${elapsedMin}分${secRemain}秒)`;
      achDiv.style.color = "green";
    }
    else {
      achDiv.textContent = `${ach.title} : 未達成`;
      achDiv.style.color = "red"; // 未達成成就顯示紅色
    }
    panelElem.appendChild(achDiv);
  });

}
function updateAchievementPanel(gameManager) {


  // check achievements
  achievements.forEach(ach => {
    if (!ach.achieved && ach.condition(gameManager)) {
      ach.achieved = true;
      ach.achieved_time = Date.now();
      addLog(`成就達成: ${ach.title}`);
    }
  });

  // 重新渲染成就列表
  renderAchievements();
}

// 範例：遊戲事件呼叫


// === Main ===

function startGame () {          // 只保留函式版本
  window.game = new GameManager();
  addLog("遊戲開始");

}
