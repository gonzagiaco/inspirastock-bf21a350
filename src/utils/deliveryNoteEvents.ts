export type DeliveryNotePriceRefreshDetail = {
  listId?: string;
  productIds?: string[];
  global?: boolean; // When true, all lists should refresh
};

const DELIVERY_NOTE_PRICE_REFRESH_EVENT = "delivery-note-prices-updated";
const deliveryNoteEventTarget = new EventTarget();

export const notifyDeliveryNotePricesUpdated = (detail: DeliveryNotePriceRefreshDetail) => {
  // Allow global refresh or specific list/product refresh
  if (!detail.global && !detail.listId && (!detail.productIds || detail.productIds.length === 0)) return;
  deliveryNoteEventTarget.dispatchEvent(
    new CustomEvent<DeliveryNotePriceRefreshDetail>(DELIVERY_NOTE_PRICE_REFRESH_EVENT, { detail }),
  );
};

export const onDeliveryNotePricesUpdated = (
  handler: (detail: DeliveryNotePriceRefreshDetail) => void,
) => {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<DeliveryNotePriceRefreshDetail>;
    handler(custom.detail);
  };

  deliveryNoteEventTarget.addEventListener(DELIVERY_NOTE_PRICE_REFRESH_EVENT, listener);
  return () => {
    deliveryNoteEventTarget.removeEventListener(DELIVERY_NOTE_PRICE_REFRESH_EVENT, listener);
  };
};
