var channels = {
  default: {
    name: 'Default',
    color: '#dddddd',
  },
  main: {
    name: 'Main Loop',
    color: '#ffffff',
  },
  cpu: {
    name: 'CPU',
    color: '#ff8080',
  },
  creeps: {
    name: 'Creeps',
    color: '#80ff80',
  },
  labs: {
    name: 'Labs',
    color: '#8080ff',
  },
  trade: {
    name: 'Trade',
    color: '#80ffff',
  },
};

var Logger = function (channel, roomName) {
  this.channel = channel;
  this.color = channels.default.color;
  this.roomName = roomName;
  this.active = true;
  this.prefix = this.getOutputPrefix();

  if (channels[this.channel]) {
    this.channelName = ('          ' + channels[this.channel].name).slice(-10);
    if (channels[this.channel].color) {
      this.color = channels[this.channel].color;
    }
  }
  else {
    this.channelName = ('          ' + this.channel).slice(-10);
  }

  if (!Memory.logger) {
    Memory.logger = {};
  }
  if (!Memory.logger.channelSettings) {
    Memory.logger.channelSettings = {};
  }

  if (Memory.logger.channelSettings[this.channel] && Memory.logger.channelSettings[this.channel].disabled) {
    this.active = false;
    // @todo allow overriding for single rooms.
  }
};

Logger.prototype.setEnabled = function (enabled) {
  if (!Memory.logger.channelSettings[this.channel]) {
    Memory.logger.channelSettings[this.channel] = {};
  }
  Memory.logger.channelSettings[this.channel].disabled = !enabled;
};

Logger.prototype.enable = function () {
  this.setEnabled(true);
};

Logger.prototype.disable = function () {
  this.setEnabled(false);
};

Logger.prototype.getOutputPrefix = function () {
  var prefix = '[<font color="'+ this.color +'">' + this.channelName + '</font>';
  prefix += ']';
  if (this.roomName) {
    let roomColor = 'ffff80';
    if (Game.rooms[this.roomName]) {
      if (!Game.rooms[this.roomName].controller) {
        roomColor = 'dddddd';
      }
      else if (Game.rooms[this.roomName].controller.my) {
        roomColor = '80ff80';
      }
      else if (Game.rooms[this.roomName].controller.owner) {
        roomColor = 'ff8080';
      }
    }
    prefix += '[<font color="#' + roomColor + '">' + this.roomName + '</font>]';
  }
  else {
    prefix += '        ';
  }

  return prefix;
};

Logger.prototype.debug = function(...args) {
  if (!this.active) return;

  var prefix = '<font color="#606060">' + this.prefix;

  console.log(prefix, ...args, '</font>');
};

Logger.prototype.info = function(...args) {
  if (!this.active) return;

  var prefix = this.prefix;

  console.log(prefix, ...args);
};

Logger.prototype.error = function(...args) {
  //if (!this.active) return;

  var prefix = '<font color="#ff8080">' + this.prefix;

  console.log(prefix, ...args, '</font>');
};

module.exports = Logger;
