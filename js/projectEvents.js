export const PROJECT_CHANGED_EVENT = "mpicture:project-changed";

export const notifyProjectChanged = () => {
  document.dispatchEvent(new Event(PROJECT_CHANGED_EVENT));
};
