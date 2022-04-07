function isHighway(roomName: string): boolean {
  return roomName.includes('0');
}

function isCrossroads(roomName: string): boolean {
  return roomName.substr(0, roomName.length - 1).includes('0') && roomName.endsWith('0');
}

export {
  isHighway,
  isCrossroads,
};
