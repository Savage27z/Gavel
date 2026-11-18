import { OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { Gesture } from "./machine";

const BY_TYPE: Partial<Record<OsEventTypeList, Gesture>> = {
  [OsEventTypeList.CLICK_EVENT]: "press",
  [OsEventTypeList.DOUBLE_CLICK_EVENT]: "doublePress",
  [OsEventTypeList.SCROLL_TOP_EVENT]: "swipeUp",
  [OsEventTypeList.SCROLL_BOTTOM_EVENT]: "swipeDown",
  [OsEventTypeList.LONG_PRESS_EVENT]: "longPress",
  [OsEventTypeList.LONG_PRESS_RELEASE_EVENT]: "longRelease",
};

export function toGesture(event: EvenHubEvent): Gesture | null {
  const source = event.textEvent ?? event.sysEvent ?? event.listEvent;
  if (!source) return null;
  return BY_TYPE[source.eventType ?? OsEventTypeList.CLICK_EVENT] ?? null;
}
