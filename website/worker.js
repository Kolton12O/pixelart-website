const { parentPort } = require("worker_threads");
const START_TIME = new Date().getTime();
console.log("working")
let counter = 0;
for (let i = 0; i < 20_000_000_000; i++) {
  counter++;
}

parentPort.postMessage({value: counter, time: (new Date().getTime() - START_TIME) / 1000});