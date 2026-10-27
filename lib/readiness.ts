// Read-only checks: probe the application table and object-store metadata.
// A missing sentinel object is normal; a failed metadata request is not.
export async function readiness(bindings:{DB?:D1Database;BUCKET?:R2Bucket}) {
  const [database,uploads]=await Promise.allSettled([
    bindings.DB?bindings.DB.prepare('SELECT id FROM projects LIMIT 1').all():Promise.reject(new Error('missing database')),
    bindings.BUCKET?bindings.BUCKET.head('__resonate_readiness__'):Promise.reject(new Error('missing storage')),
  ]);
  const dbReady=database.status==='fulfilled'&&database.value.success===true;
  const storageReady=uploads.status==='fulfilled';
  return Response.json({ok:dbReady&&storageReady,service:'relay-api',version:'0.1.0',database:dbReady,uploads:storageReady},
    {status:dbReady&&storageReady?200:503,headers:{'Cache-Control':'no-store'}});
}
