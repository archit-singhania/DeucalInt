import { randomUUID } from 'node:crypto';
export class DeucalIntNode {
  constructor({ projectToken, endpoint, sessionId = randomUUID() }) {
    this.projectToken = projectToken;
    this.endpoint = endpoint;
    this.sessionId = sessionId;
    this.queue = [];
  }
  track(name, properties = {}, anonymousId = 'server') {
    this.queue.push({
      eventId: randomUUID(),
      schemaVersion: 1,
      type: 'product',
      name,
      timestamp: new Date().toISOString(),
      anonymousId,
      sessionId: this.sessionId,
      properties,
    });
  }
  async flush() {
    while (this.queue.length) {
      const batch = this.queue.slice(0, 100);
      let error;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const response = await fetch(this.endpoint + '/v1/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectToken: this.projectToken, events: batch }),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error('Collector returned ' + response.status);
          error = null;
          break;
        } catch (e) {
          error = e;
          await new Promise((r) => setTimeout(r, 2 ** attempt * 200));
        }
      }
      if (error) throw error;
      this.queue.splice(0, batch.length);
    }
  }
}
