export type DragAction<V = any> = {
  dataTransfer: DataTransfer;
  fromIndex: number;
  value: V;
};

export type DropAction = {
  dataTransfer: DataTransfer;
  toIndex: number;
};
