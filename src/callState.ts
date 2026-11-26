// Shared flag so App's background auto-lock doesn't fire mid-call.
let active = false;
export const callActive = {
  get: () => active,
  set: (v: boolean) => {
    active = v;
  },
};
