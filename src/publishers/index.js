'use strict';

module.exports = {
  vk_group: require('./vk').publishVkGroup,
  tg_personal: require('./tgPersonal').publishTgPersonal,
  tg_channel: require('./tgChannel').publishTgChannel,
};
