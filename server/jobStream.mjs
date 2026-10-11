import {subscribeJob} from './jobs.mjs';

export function streamJob(req, res, uid) {
  const send = ({id, type, job}) => {
    if (res.destroyed || res.writableEnded) return;
    // Disconnect slow clients; reconnecting restores a complete snapshot.
    if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
    res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(job)}\n\n`);
    if (job.status !== 'running') res.end();
  };
  // Ownership is checked before any SSE headers are sent.
  const {snapshot, unsubscribe} = subscribeJob(req.params.id, uid, send);
  res.on('close', unsubscribe);
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  send({id: snapshot.eventId, type: 'snapshot', job: snapshot});
}
