const fs = require("fs");
const path = require("path");
const os = require("os");

const MEM_DIR = path.join(os.homedir(), ".sapni", "mem");

function _ensureDir() {
  if (!fs.existsSync(MEM_DIR)) fs.mkdirSync(MEM_DIR, { recursive: true });
}

class FiveLayerMemory {
  constructor(options = {}) {
    // 配置
    this.config = {
      workingMemorySize: options.workingMemorySize || 50,
      shortTermSize: options.shortTermSize || 200,
      episodicSize: options.episodicSize || 500,
      semanticSize: options.semanticSize || 1000,
      proceduralSize: options.proceduralSize || 200,
      maxEntryChars: options.maxEntryChars || 500,
    };

    // ========== 第1层: Working Memory (工作记忆) ==========
    // 当前会话的对话历史
    this.workingMemory = [];

    // ========== 第2层: Short-term Memory (短期记忆) ==========
    // 最近几次会话的摘要
    this.shortTermMemory = [];

    // ========== 第3层: Episodic Memory (情景记忆) ==========
    // 事件、经历、特定时间点的事实
    this.episodicMemory = [];

    // ========== 第4层: Semantic Memory (语义记忆) ==========
    // 知识、事实、概念（不依赖于特定时间和地点）
    this.semanticMemory = [];

    // ========== 第5层: Procedural Memory (程序记忆) ==========
    // 技能、流程、操作步骤
    this.proceduralMemory = [];

    // 当前目标
    this.currentGoal = null;
    this.goalHistory = [];
    this._idCounter = Date.now();

    // 加载持久化数据
    this._loadFromDisk();
  }

  // ========== 工作记忆操作 ==========

  addToWorkingMemory(role, content) {
    const entry = {
      id: ++this._idCounter,
      role,
      content: String(content).slice(0, this.config.maxEntryChars),
      timestamp: Date.now(),
      layer: "working",
    };
    this.workingMemory.push(entry);
    this._trimWorkingMemory();
    return entry;
  }

  getWorkingMemory() {
    return [...this.workingMemory];
  }

  _trimWorkingMemory() {
    while (this.workingMemory.length > this.config.workingMemorySize * 2) {
      this.workingMemory.shift();
    }
  }

  // ========== 短期记忆操作 ==========

  addToShortTerm(summary, sessionId) {
    const entry = {
      id: ++this._idCounter,
      summary: String(summary).slice(0, this.config.maxEntryChars),
      sessionId,
      timestamp: Date.now(),
      layer: "shortTerm",
    };
    this.shortTermMemory.push(entry);
    this._trimShortTerm();
    this._saveToDisk();
    return entry;
  }

  searchShortTerm(query, limit = 5) {
    return this._searchMemory(this.shortTermMemory, query, limit);
  }

  _trimShortTerm() {
    while (this.shortTermMemory.length > this.config.shortTermSize) {
      this.shortTermMemory.shift();
    }
  }

  // ========== 情景记忆操作 ==========

  addToEpisodic(event, context = {}, tags = []) {
    const entry = {
      id: ++this._idCounter,
      event: String(event).slice(0, this.config.maxEntryChars),
      context,
      tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
      timestamp: Date.now(),
      layer: "episodic",
    };
    this.episodicMemory.push(entry);
    this._trimEpisodic();
    this._saveToDisk();
    return entry;
  }

  searchEpisodic(query, limit = 5) {
    return this._searchMemory(this.episodicMemory, query, limit);
  }

  _trimEpisodic() {
    while (this.episodicMemory.length > this.config.episodicSize) {
      this.episodicMemory.shift();
    }
  }

  // ========== 语义记忆操作 ==========

  addToSemantic(fact, source = "", confidence = 1.0) {
    const entry = {
      id: ++this._idCounter,
      fact: String(fact).slice(0, this.config.maxEntryChars),
      source,
      confidence: Math.min(1.0, Math.max(0.0, confidence)),
      timestamp: Date.now(),
      accessedCount: 0,
      layer: "semantic",
    };
    this.semanticMemory.push(entry);
    this._trimSemantic();
    this._saveToDisk();
    return entry;
  }

  searchSemantic(query, limit = 5) {
    const results = this._searchMemory(this.semanticMemory, query, limit);
    // 更新访问计数
    results.forEach(r => {
      const idx = this.semanticMemory.findIndex(e => e.id === r.id);
      if (idx !== -1) this.semanticMemory[idx].accessedCount++;
    });
    return results;
  }

  updateSemanticConfidence(id, newConfidence) {
    const idx = this.semanticMemory.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.semanticMemory[idx].confidence = Math.min(1.0, Math.max(0.0, newConfidence));
      this._saveToDisk();
      return true;
    }
    return false;
  }

  _trimSemantic() {
    // 保留高置信度和高访问频率的条目
    this.semanticMemory.sort((a, b) => {
      const scoreA = a.confidence * 0.7 + (a.accessedCount / 100) * 0.3;
      const scoreB = b.confidence * 0.7 + (b.accessedCount / 100) * 0.3;
      return scoreB - scoreA;
    });
    if (this.semanticMemory.length > this.config.semanticSize) {
      this.semanticMemory = this.semanticMemory.slice(0, this.config.semanticSize);
    }
  }

  // ========== 程序记忆操作 ==========

  addToProcedural(skillName, steps, description = "", tags = []) {
    const entry = {
      id: ++this._idCounter,
      skillName: String(skillName).slice(0, 100),
      steps: Array.isArray(steps) ? steps : [],
      description: String(description).slice(0, this.config.maxEntryChars),
      tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
      timestamp: Date.now(),
      usedCount: 0,
      layer: "procedural",
    };
    this.proceduralMemory.push(entry);
    this._trimProcedural();
    this._saveToDisk();
    return entry;
  }

  searchProcedural(query, limit = 5) {
    const results = this._searchMemory(this.proceduralMemory, query, limit);
    // 更新使用计数
    results.forEach(r => {
      const idx = this.proceduralMemory.findIndex(e => e.id === r.id);
      if (idx !== -1) this.proceduralMemory[idx].usedCount++;
    });
    return results;
  }

  updateProceduralSteps(id, newSteps) {
    const idx = this.proceduralMemory.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.proceduralMemory[idx].steps = Array.isArray(newSteps) ? newSteps : [];
      this.proceduralMemory[idx].timestamp = Date.now();
      this._saveToDisk();
      return true;
    }
    return false;
  }

  _trimProcedural() {
    // 保留使用频率高的技能
    this.proceduralMemory.sort((a, b) => b.usedCount - a.usedCount);
    if (this.proceduralMemory.length > this.config.proceduralSize) {
      this.proceduralMemory = this.proceduralMemory.slice(0, this.config.proceduralSize);
    }
  }

  // ========== 通用搜索 ==========

  _searchMemory(memoryArray, query, limit) {
    if (!query || !query.trim()) {
      return [...memoryArray].slice(-limit);
    }

    const q = query.toLowerCase();
    const scored = memoryArray.map((entry) => {
      let score = 0;
      const text = (entry.fact || entry.event || entry.summary || entry.skillName || "").toLowerCase();
      
      if (text === q) score = 100;
      else if (text.includes(q)) score = 60;
      else {
        const words = q.split(/\s+/);
        for (const w of words) {
          if (w && text.includes(w)) score += 15;
        }
      }

      // 标签匹配
      if (entry.tags && Array.isArray(entry.tags)) {
        const tagMatch = entry.tags.some(t => String(t).toLowerCase().includes(q));
        if (tagMatch) score += 30;
      }

      // 描述匹配
      if (entry.description) {
        if (entry.description.toLowerCase().includes(q)) score += 20;
      }

      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > 0).slice(0, limit).map(s => s.entry);
  }

  searchAllLayers(query, limit = 5) {
    const results = [];
    
    results.push(...this.searchShortTerm(query, limit).map(e => ({ ...e, layer: "短期记忆" })));
    results.push(...this.searchEpisodic(query, limit).map(e => ({ ...e, layer: "情景记忆" })));
    results.push(...this.searchSemantic(query, limit).map(e => ({ ...e, layer: "语义记忆" })));
    results.push(...this.searchProcedural(query, limit).map(e => ({ ...e, layer: "程序记忆" })));

    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  }

  // ========== 目标管理 ==========

  setGoal(goal, description = "", priority = "medium") {
    this.currentGoal = {
      id: ++this._idCounter,
      goal: String(goal).slice(0, 500),
      description: String(description).slice(0, this.config.maxEntryChars),
      priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      progress: 0,
      subGoals: [],
    };
    return this.currentGoal;
  }

  updateGoalProgress(progress) {
    if (this.currentGoal) {
      this.currentGoal.progress = Math.min(100, Math.max(0, progress));
      this.currentGoal.updatedAt = Date.now();
      if (this.currentGoal.progress >= 100) {
        this.currentGoal.status = "completed";
        this.archiveGoal();
      }
      return true;
    }
    return false;
  }

  addSubGoal(subGoal) {
    if (this.currentGoal) {
      const sub = {
        id: ++this._idCounter,
        goal: String(subGoal).slice(0, 300),
        status: "pending",
        createdAt: Date.now(),
      };
      this.currentGoal.subGoals.push(sub);
      this.currentGoal.updatedAt = Date.now();
      return sub;
    }
    return null;
  }

  completeSubGoal(subGoalId) {
    if (this.currentGoal && this.currentGoal.subGoals) {
      const idx = this.currentGoal.subGoals.findIndex(s => s.id === subGoalId);
      if (idx !== -1) {
        this.currentGoal.subGoals[idx].status = "completed";
        this.currentGoal.subGoals[idx].completedAt = Date.now();
        this.currentGoal.updatedAt = Date.now();
        
        // 更新总体进度
        const completed = this.currentGoal.subGoals.filter(s => s.status === "completed").length;
        const total = this.currentGoal.subGoals.length;
        if (total > 0) {
          this.currentGoal.progress = Math.round((completed / total) * 100);
        }
        
        if (this.currentGoal.progress >= 100) {
          this.currentGoal.status = "completed";
          this.archiveGoal();
        }
        return true;
      }
    }
    return false;
  }

  archiveGoal() {
    if (this.currentGoal) {
      this.goalHistory.push({ ...this.currentGoal });
      this._trimGoalHistory();
      this._saveToDisk();
    }
  }

  clearGoal() {
    if (this.currentGoal) {
      this.archiveGoal();
    }
    this.currentGoal = null;
  }

  getCurrentGoal() {
    return this.currentGoal;
  }

  getGoalHistory(limit = 10) {
    return [...this.goalHistory].slice(-limit).reverse();
  }

  _trimGoalHistory() {
    while (this.goalHistory.length > 100) {
      this.goalHistory.shift();
    }
  }

  // ========== 持久化 ==========

  _saveToDisk() {
    _ensureDir();
    try {
      const data = {
        shortTerm: this.shortTermMemory,
        episodic: this.episodicMemory,
        semantic: this.semanticMemory,
        procedural: this.proceduralMemory,
        goalHistory: this.goalHistory,
        idCounter: this._idCounter,
      };
      fs.writeFileSync(path.join(MEM_DIR, "five-layer-memory.json"), JSON.stringify(data, null, 2), "utf-8");
    } catch (_) {}
  }

  _loadFromDisk() {
    try {
      const filePath = path.join(MEM_DIR, "five-layer-memory.json");
      if (!fs.existsSync(filePath)) return;
      
      const raw = fs.readFileSync(filePath, "utf-8");
      if (!raw.trim()) return;
      
      const data = JSON.parse(raw);
      
      if (data.shortTerm) this.shortTermMemory = data.shortTerm;
      if (data.episodic) this.episodicMemory = data.episodic;
      if (data.semantic) this.semanticMemory = data.semantic;
      if (data.procedural) this.proceduralMemory = data.procedural;
      if (data.goalHistory) this.goalHistory = data.goalHistory;
      if (data.idCounter) this._idCounter = Math.max(this._idCounter, data.idCounter);
      
    } catch (_) {}
  }

  // ========== 统计信息 ==========

  stats() {
    return {
      workingMemory: this.workingMemory.length,
      shortTermMemory: this.shortTermMemory.length,
      episodicMemory: this.episodicMemory.length,
      semanticMemory: this.semanticMemory.length,
      proceduralMemory: this.proceduralMemory.length,
      currentGoal: this.currentGoal ? "active" : "none",
      goalHistory: this.goalHistory.length,
    };
  }

  // ========== 清空 ==========

  clearAll() {
    this.workingMemory = [];
    this.shortTermMemory = [];
    this.episodicMemory = [];
    this.semanticMemory = [];
    this.proceduralMemory = [];
    this.currentGoal = null;
    this.goalHistory = [];
    this._saveToDisk();
  }
}

module.exports = { FiveLayerMemory };
