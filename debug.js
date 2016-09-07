var channels = {
  default: {
    name: 'Default',
    color: '#dddddd',
  },
  main: {
    name: 'Main Loop',
    color: '#ffffff',
  },
  creeps: {
    name: 'Creeps',
    color: '#80ff80',
  },
};

var Logger = function (channel, roomName) {
  this.channel = channel;
  this.color = channels.default.color;
  this.roomName = roomName;
  this.active = true;

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

Logger.prototype.log = function(...args) {
  if (!this.active) return;

  var prefix = '[<font color="'+ this.color +'">' + this.channelName + '</font>';
  prefix += ']';
  if (this.roomName) {
    prefix += '[<font color="#ffff80">' + this.roomName + '</font>]';
  }

  console.log(prefix, ...args);
};

Logger.prototype.error = function(...args) {
  //if (!this.active) return;

  var prefix = '<font color="#ff8080">';
  prefix += '[<font color="'+ this.color +'">' + this.channelName + '</font>';
  prefix += ']';
  if (this.roomName) {
    prefix += '[<font color="#ffff80">' + this.roomName + '</font>]';
  }

  console.log(prefix, ...args, '</font>');
};

module.exports = {
  init: function () {
    Game.logger = Logger;
  },
};
