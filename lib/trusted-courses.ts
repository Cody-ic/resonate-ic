import snapshots from "../content/trusted-courses.json";
// Only a reviewed, imported revision may open executable interactive HTML.
// User-submitted HTML is never registered here or rendered on this origin.
export function trustedCourse(courseId:string,revisionId:string) {
  const snapshot=snapshots.find(s=>s.courseId===courseId&&s.revisionId===revisionId);
  return snapshot
    ? {basePath:snapshot.basePath,version:snapshot.version,entry:`${snapshot.basePath}/index.html`,sourceDigest:snapshot.sourceDigest,
      lessons:snapshot.lessonPaths} : null;
}
