// A packed @tarfa/cli carries its workspace packages inside dist/, so none of them may remain as
// a dependency: pnpm would turn `workspace:*` into a version that is not on any registry.
module.exports = {
  hooks: {
    beforePacking(pkg) {
      if (pkg.name !== '@tarfa/cli') return pkg;
      delete pkg.devDependencies;
      delete pkg.scripts.prepack;
      delete pkg.scripts.test;
      delete pkg.scripts.typecheck;
      delete pkg.scripts.build;
      return pkg;
    },
  },
};
