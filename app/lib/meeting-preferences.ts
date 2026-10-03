import { uiStorage } from "./ui-storage";
export function meetingMicrophone() {
  return uiStorage.getItem("hyperion:meeting-microphone") ?? "";
}
export function setMeetingMicrophone(id: string) {
  uiStorage.setItem("hyperion:meeting-microphone", id);
}
export async function meetingMicrophones(requestAccess = false) {
  if (!navigator.mediaDevices)
    throw new Error("Microphone access is unavailable in this environment.");
  if (requestAccess) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  }
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "audioinput",
  );
}
