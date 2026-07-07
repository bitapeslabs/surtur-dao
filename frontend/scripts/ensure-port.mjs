// Fail fast when the requested dev port is taken, instead of letting Next
// silently hop to the next free port. The usual culprit is an orphaned dev
// server, or the snowfort (vendor) app having hopped onto this port after
// its own port was busy — which then "bleeds" the wrong app into this
// origin (and its localStorage).
import net from 'node:net';

const port = Number(process.argv[2]);
const srv = net.createServer();
srv.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${port} is already in use — another dev server is running there.`);
    console.error(`  Find it:  ss -ltnp | grep ${port}`);
    console.error(`  Kill it:  pkill -f 'next dev'\n`);
    process.exit(1);
  }
  throw err;
});
srv.once('listening', () => srv.close());
srv.listen(port);
