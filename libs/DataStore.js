const assert = require("assert");
const fs = require("fs");

class DataStore {
  constructor({ persistentDataFile, defaultData = {} }) {
    assert(persistentDataFile, `persistentDataFile is required`);
    this.persistentDataFile = persistentDataFile;
    this.data = defaultData;
  }

  async restore() {
    let rawPersistentData;
    try {
      rawPersistentData = await fs.promises.readFile(this.persistentDataFile);
    } catch (e) {
      // best effort, file may not have existed
    }

    if (rawPersistentData) {
      Object.assign(this.data, JSON.parse(rawPersistentData));
      console.log("data restored from disk");
      console.debug("data contents:", this.data);
    }
  }

  async persist() {
    await fs.promises.writeFile(
      this.persistentDataFile,
      JSON.stringify(this.data)
    );
  }

  async initialize() {
    await this.restore();

    setInterval(
      async () => {
        await this.persist();
      },
      10 * 1000 // 10 seconds
    );
  }
}

module.exports = DataStore;
