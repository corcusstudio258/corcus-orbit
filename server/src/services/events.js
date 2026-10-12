// Tiny in-process event bus. Routes emit domain events; automations, rewards and
// recurrence listen. Listeners never block or break the request that emitted the event.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

function emit(name, payload) {
  for (const fn of bus.listeners(name)) {
    Promise.resolve()
      .then(() => fn(payload))
      .catch((e) => console.error(`[events] ${name} listener failed:`, e.message));
  }
}

const on = (name, fn) => bus.on(name, fn);

module.exports = { emit, on };
