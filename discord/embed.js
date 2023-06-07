import {
    getBuddy,
    getBundle,
    getCard,
    getSkin,
    getSkinFromSkinUuid,
    getSpray,
    getTitle,
    getWeapon
} from "../valorant/cache.js";
import {
    skinNameAndEmoji,
    itemTypes,
    removeAlertActionRow,
    removeAlertButton,
    fetchChannel, isDefaultSkin, WeaponTypeUuid, fetch
} from "../misc/util.js";
import config from "../misc/config.js";
import {DEFAULT_VALORANT_LANG, discToValLang, l, s} from "../misc/languages.js";
import {ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder} from "discord.js";
import {getStatsFor} from "../misc/stats.js";
import {getUser} from "../valorant/auth.js";
import {readUserJson, removeDupeAccounts, saveUser} from "../valorant/accountSwitcher.js";
import {getSetting, humanifyValue, settingIsVisible, settingName} from "../misc/settings.js";
import {VPEmoji} from "./emoji.js";
import {getNextNightMarketTimestamp} from "../valorant/shop.js";


export const VAL_COLOR_1 = 0xFD4553;
export const VAL_COLOR_2 = 0x202225;
export const VAL_COLOR_3 = 0xEAEEB2;

const thumbnails = [
    "https://media.valorant-api.com/sprays/290565e7-4540-5764-31da-758846dc2a5a/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/31ba7f82-4fcb-4cbb-a719-06a3beef8603/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/fef66645-4e35-ff38-1b7c-799dd5fc7468/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/02f4c1db-46bb-a572-e830-0886edbb0981/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/40222bb5-4fce-9320-f4f1-95861df83c47/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/a7e1a9b6-4ab5-e6f7-e5fe-bc86f87b44ee/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/09786b0a-4c3e-5ba8-46ab-c49255620a5f/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/7b0e0c8d-4f91-2a76-19b9-079def2fa843/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/ea087a08-4b9f-bd0d-15a5-d3ba09c4c381/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/40ff9251-4c11-b729-1f27-088ee032e7ce/fulltransparenticon.png"
];

export const authFailureMessage = (interactionOrId, authResponse, message="AUTH_ERROR", isEphemeral=false) => {
    const id = interactionOrId?.user?.id || interactionOrId;
    const tag = interactionOrId?.user?.tag || id;
    let embed;

    if(authResponse.maintenance) embed = basicEmbed(s(interactionOrId).error.MAINTENANCE);
    else if(authResponse.mfa) {
        console.log(`${tag} needs 2FA code`);
        if(authResponse.method === "email") {
            if(isEphemeral) embed = basicEmbed(s(interactionOrId).info.MFA_EMAIL.f({e: escapeMarkdown(authResponse.email)}));
            else embed = basicEmbed(s(interactionOrId).info.MFA_EMAIL_HIDDEN);
        }
        else embed = basicEmbed(s(interactionOrId).info.MFA_GENERIC);
    }
    else if(authResponse.rateLimit) {
        console.log(`${tag} got rate-limited`);
        if(typeof authResponse.rateLimit === "number") embed = basicEmbed(s(interactionOrId).error.LOGIN_RATELIMIT_UNTIL.f({t: Math.ceil(authResponse.rateLimit / 1000)}));
        else embed = basicEmbed(s(interactionOrId).error.LOGIN_RATELIMIT);
    }
    else {
        embed = basicEmbed(message);

        // two-strike system
        const user = getUser(id);
        if(user) {
            user.authFailures++;
            saveUser(user);
        }
    }

    return {
        embeds: [embed],
        ephemeral: true
    }
}

export const skinChosenEmbed = async (interaction, skin) => {
    const channel = interaction.channel || await fetchChannel(interaction.channelId);
    let description = s(interaction).info.ALERT_SET.f({s: await skinNameAndEmoji(skin, channel, interaction)});
    if(config.fetchSkinPrices && !skin.price) description += s(interaction).info.ALERT_BP_SKIN;
    return {
        description: description,
        color: VAL_COLOR_1,
        thumbnail: {
            url: skin.icon
        }
    }
}

export const renderOffers = async (shop, interaction, valorantUser, VPemoji, otherId=null) => {
    const forOtherUser = otherId && otherId !== interaction.user.id;
    const otherUserMention = `<@${otherId}>`;

    if(!shop.success) {
        let errorText;

        if(forOtherUser) errorText = s(interaction).error.AUTH_ERROR_SHOP_OTHER.f({u: otherUserMention});
        else errorText = s(interaction).error.AUTH_ERROR_SHOP;

        return authFailureMessage(interaction, shop, errorText);
    }

    let headerText;
    if(forOtherUser) {
        const json = readUserJson(otherId);

        let usernameText = otherUserMention;
        if(json.accounts.length > 1) usernameText += ' ' + s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: json.currentAccount});

        headerText = s(interaction).info.SHOP_HEADER.f({u: usernameText, t: shop.expires});
    }
    else headerText = s(interaction).info.SHOP_HEADER.f({u: valorantUser.username, t: shop.expires}, interaction);

    const embeds = [headerEmbed(headerText)];

    for(const uuid of shop.offers) {
        const skin = await getSkin(uuid);
        const price = isDefaultSkin(skin) ? "0" : skin.price; // force render price for defaults
        const embed = await skinEmbed(skin.uuid, price, interaction, VPemoji);
        embeds.push(embed);
    }

    // show notice if there is one
    if(config.notice) {
        // users shouldn't see the same notice twice
        if(!config.onlyShowNoticeOnce || valorantUser.lastNoticeSeen !== config.notice) {

            // the notice can either be just a simple string, or a raw JSON embed data object
            if(typeof config.notice === "string") {
                if(config.notice.startsWith('{')) embeds.push(EmbedBuilder.from(JSON.parse(config.notice)).toJSON());
                else embeds.push(basicEmbed(config.notice));
            }
            else embeds.push(EmbedBuilder.from(config.notice).toJSON());

            valorantUser.lastNoticeSeen = config.notice;
            saveUser(valorantUser);
        }
    }

    let components;
    if(forOtherUser){
        components = null;
    } else {
        components = switchAccountButtons(interaction, "shop", true);
    }

    const levels = await getSkinLevels(shop.offers, interaction);
    if(levels) components === null ? components = [levels] : components.unshift(levels)

    return {
        embeds, components
    };
}

export const getSkinLevels = async (offers, interaction) => {
    const skinSelector = new StringSelectMenuBuilder()
        .setCustomId("select-skin-with-level")
        .setPlaceholder(s(interaction).info.SELECT_SKIN_WITH_LEVEL)

    for (const uuid of offers) {
        let skin = await getSkin(uuid);
        if(!skin) continue;
        const req = await fetch(`https://valorant-api.com/v1/weapons/skins/${skin.skinUuid}`);
        const json = JSON.parse(req.body);

        for (let i = 0; i < json.data.levels.length; i++) {
            const level = json.data.levels[i];
            if(level.streamedVideo){
                skinSelector.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`${l(skin.names, interaction)}`)
                        .setValue(`${skin.skinUuid}`)
                )
                break;
            }
        }
    }

    if(skinSelector.options.length===0) return false;
    return new ActionRowBuilder().addComponents(skinSelector);
}

export const renderBundles = async (bundles, interaction, VPemoji) => {
    if(!bundles.success) return authFailureMessage(interaction, bundles, s(interaction).error.AUTH_ERROR_BUNDLES);

    bundles = bundles.bundles;

    if(bundles.length === 1) {
        const bundle = await getBundle(bundles[0].uuid);

        const renderedBundle = await renderBundle(bundle, interaction, VPemoji, false);
        const titleEmbed = renderedBundle.embeds[0];
        titleEmbed.title = s(interaction).info.BUNDLE_HEADER.f({b: titleEmbed.title});
        titleEmbed.description += ` *(${s(interaction).info.EXPIRES.f({t: bundle.expires})})*`;

        return renderedBundle;
    }

    const embeds = [{
        title: s(interaction).info.BUNDLES_HEADER,
        description: s(interaction).info.BUNDLES_HEADER_DESC,
        color: VAL_COLOR_1
    }];

    const buttons = [];

    for(const bundleData of bundles) {
        const bundle = await getBundle(bundleData.uuid);

        const subName = bundle.subNames ? l(bundle.subNames, interaction) + "\n" : "";
        const slantedDescription = bundle.descriptions ? "*" + l(bundle.descriptions, interaction) + "*\n" : "";
        const embed = {
            title: s(interaction).info.BUNDLE_NAME.f({b: l(bundle.names, interaction)}),
            description: `${subName}${slantedDescription}${VPemoji} **${bundle.price || s(interaction).info.FREE}** - ${s(interaction).info.EXPIRES.f({t:bundle.expires})}`,
            color: VAL_COLOR_2,
            thumbnail: {
                url: bundle.icon
            }
        };
        embeds.push(embed);

        if(buttons.length < 5) {
            buttons.push(new ButtonBuilder().setCustomId(`viewbundle/${interaction.user.id}/${bundle.uuid}`).setStyle(ButtonStyle.Primary).setLabel(l(bundle.names, interaction)).setEmoji("🔎"));
        }
    }

    return {
        embeds: embeds,
        components: [new ActionRowBuilder().addComponents(...buttons)]
    };
}

export const renderBundle = async (bundle, interaction, emoji, includeExpires=true) => {
    const subName = bundle.subNames ? l(bundle.subNames, interaction) + "\n" : "";
    const slantedDescription = bundle.descriptions ? "*" + l(bundle.descriptions, interaction) + "*\n" : "";
    const strikedBundleBasePrice = bundle.basePrice ? " ~~" + bundle.basePrice + "~~" : "";
    const UnixStamp = bundle.last_seen / 1000 ? `\n_${s(interaction).info.BUNDLE_RELEASED.f({t: bundle.last_seen / 1000})}_\n` : "";

    if(!bundle.items) return {embeds: [{
        title: s(interaction).info.BUNDLE_NAME.f({b: l(bundle.names, interaction)}),
        description: `${subName}${slantedDescription}`,
        color: VAL_COLOR_1,
        image: {
            url: bundle.icon
        },
        footer: {
            text: s(interaction).info.NO_BUNDLE_DATA
        }
    }]};

    const bundleTitleEmbed = {
        title: s(interaction).info.BUNDLE_NAME.f({b: l(bundle.names, interaction)}),
        description: `${subName}${slantedDescription}${UnixStamp}${emoji} **${bundle.price}**${strikedBundleBasePrice}`,
        color: VAL_COLOR_3,
        image: {
            url: bundle.icon
        }
    }

    if(includeExpires && bundle.expires) bundleTitleEmbed.description += ` (${(bundle.expires > Date.now() / 1000 ? 
        s(interaction).info.EXPIRES : s(interaction).info.EXPIRED).f({t: bundle.expires})})`;

    const itemEmbeds = await renderBundleItems(bundle, interaction, emoji);
    const levels = await getSkinLevels(bundle.items.map(i=>i.uuid), interaction);
    return levels ? {embeds: [bundleTitleEmbed, ...itemEmbeds], components: [levels]} : {embeds: [bundleTitleEmbed, ...itemEmbeds]};
}

export const renderNightMarket = async (market, interaction, valorantUser, emoji) => {
    if(!market.success) return authFailureMessage(interaction, market, s(interaction).error.AUTH_ERROR_NMARKET);

    if(!market.offers) {
        const nextNightMarketTimestamp = await getNextNightMarketTimestamp();
        const text = nextNightMarketTimestamp ? s(interaction).error.NO_NMARKET_WITH_DATE.f({t: nextNightMarketTimestamp}) : s(interaction).error.NO_NMARKET;
        return {embeds: [basicEmbed(text)]};
    }

    const embeds = [{
        description: s(interaction).info.NMARKET_HEADER.f({u: valorantUser.username, t: market.expires}, interaction),
        color: VAL_COLOR_3
    }];

    for(const offer of market.offers) {
        const skin = await getSkin(offer.uuid);

        const embed = await skinEmbed(skin.uuid, skin.price, interaction, emoji);
        embed.description = `${emoji} **${offer.nmPrice}**\n${emoji} ~~${offer.realPrice}~~ (-${offer.percent}%)`;

        embeds.push(embed);
    }

    const components = switchAccountButtons(interaction, "nm", true);
    return {
        embeds, components
    };
}

export const renderBattlepass = async (battlepass, targetlevel, interaction) => {
    if(!battlepass.success) return authFailureMessage(interaction, battlepass, s(interaction).error.AUTH_ERROR_BPASS);
    if(battlepass.nextReward.rewardType === "EquippableCharmLevel"){
          battlepass.nextReward.rewardType = s(interaction).battlepass.GUN_BUDDY;
      }
      if(battlepass.nextReward.rewardType === "EquippableSkinLevel"){
          battlepass.nextReward.rewardType = s(interaction).battlepass.SKIN;
      }
      if(battlepass.nextReward.rewardType === "PlayerCard"){
          battlepass.nextReward.rewardType = s(interaction).battlepass.CARD;
      }

      if(battlepass.nextReward.rewardName === undefined) {
          battlepass.nextReward.rewardName = "Name not found"
      }
    const user = getUser(interaction.user.id);

    let embeds = []
    if(battlepass.bpdata.progressionLevelReached < 55) {
        embeds.push({
            title: s(interaction).battlepass.CALCULATIONS_TITLE,
            thumbnail: {url: thumbnails[Math.floor(Math.random()*thumbnails.length)]},
            description: `${s(interaction).battlepass.TIER_HEADER.f({u: user.username}, interaction)}\n${createProgressBar(battlepass.xpneeded, battlepass.bpdata.progressionTowardsNextLevel, battlepass.bpdata.progressionLevelReached)}`,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": s(interaction).battlepass.GENERAL_COL,
                    "value": `${s(interaction).battlepass.TOTAL_ROW}\n${s(interaction).battlepass.LVLUP_ROW}\n${s(interaction).battlepass.TIER50_ROW.f({t: targetlevel})}\n${s(interaction).battlepass.WEEKLY_LEFT_ROW}`,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.XP_COL,
                    "value": `\`${battlepass.totalxp}\`\n\`${battlepass.xpneeded}\`\n\`${battlepass.totalxpneeded}\`\n\`${battlepass.weeklyxp}\``,
                    "inline": true
                }
            ],
            footer: {
                text: battlepass.battlepassPurchased ? s(interaction).battlepass.BP_PURCHASED.f({u: user.username}, interaction) : ""
            }
        },
        {
            title: s(interaction).battlepass.GAMES_HEADER,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": s(interaction).battlepass.GAMEMODE_COL,
                    "value": `${s(interaction).battlepass.SPIKERUSH_ROW}\n${s(interaction).battlepass.NORMAL_ROW}\n`,
                    "inline": true
                },
                {
                    "name": "#",
                    "value": `\`${battlepass.spikerushneeded}\`\n\`${battlepass.normalneeded}\``,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.INCL_WEEKLIES_COL,
                    "value": `\`${battlepass.spikerushneededwithweeklies}\`\n\`${battlepass.normalneededwithweeklies}\``,
                    "inline": true
                }
            ],
            footer: {
                text: s(interaction).battlepass.ACT_END.f({d: battlepass.season_days_left})
            }
        },
        {
            title: s(interaction).battlepass.XP_HEADER,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": s(interaction).battlepass.AVERAGE_COL,
                    "value": `${s(interaction).battlepass.DAILY_XP_ROW}\n${s(interaction).battlepass.WEEKLY_XP_ROW}`,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.XP_COL,
                    "value": `\`${battlepass.dailyxpneeded}\`\n\`${battlepass.weeklyxpneeded}\``,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.INCL_WEEKLIES_COL,
                    "value": `\`${battlepass.dailyxpneededwithweeklies}\`\n\`${battlepass.weeklyxpneededwithweeklies}\``,
                    "inline": true
                }
            ]
        },
        {
            title: s(interaction).battlepass.NEXT_BP_REWARD,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": `**${s(interaction).battlepass.TYPE}:** \`${battlepass.nextReward.rewardType}\``,
                    "value": `**${s(interaction).battlepass.REWARD}:** ${battlepass.nextReward.rewardName}\n**XP:** ${battlepass.bpdata.progressionTowardsNextLevel}/${battlepass.nextReward.XP}`,
                    "inline": true
                },
            ],
            thumbnail: {
              url: battlepass.nextReward.rewardIcon,
            },
        });
    } else {
        embeds.push({
            description: s(interaction).battlepass.FINISHED,
            color: VAL_COLOR_1,
        })
    }

    const components = switchAccountButtons(interaction, "bp");

    return {embeds, components};
}

const renderBundleItems = async (bundle, interaction, VPemojiString) => {
    if(!bundle.items) return [];

    const priorities = {};
    priorities[itemTypes.SKIN] = 5;
    priorities[itemTypes.BUDDY] = 4;
    priorities[itemTypes.SPRAY] = 3;
    priorities[itemTypes.CARD] = 2;
    priorities[itemTypes.TITLE] = 1;

    const items = bundle.items.sort((a, b) => priorities[b.type] - priorities[a.type]);

    const embeds = [];
    for(const item of items) {
        const embed = await bundleItemEmbed(item, interaction, VPemojiString);

        if(item.amount !== 1) embed.title = `${item.amount}x ${embed.title}`;
        if(item.basePrice && item.price !== item.basePrice) {
            embed.description = `${VPemojiString} **${item.price || s(interaction).info.FREE}** ~~${item.basePrice}~~`;
            if(item.type === itemTypes.TITLE) embed.description = "`" + item.item.text + "`\n\n" + embed.description
        }

        embeds.push(embed);
    }

    // discord has a limit of 10 embeds (9 if we count the bundle title)
    if(embeds.length > 9) {
        embeds.length = 8;
        embeds.push(basicEmbed(s(interaction).info.MORE_ITEMS.f({n: items.length - 8})));
    }

    return embeds;
}

const bundleItemEmbed = async (item, interaction, VPemojiString) => {
    switch(item.type) {
        case itemTypes.SKIN: return skinEmbed(item.uuid, item.price, interaction, VPemojiString);
        case itemTypes.BUDDY: return buddyEmbed(item.uuid, item.price, interaction, VPemojiString);
        case itemTypes.CARD: return cardEmbed(item.uuid, item.price, interaction, VPemojiString);
        case itemTypes.SPRAY: return sprayEmbed(item.uuid, item.price, interaction, VPemojiString);
        case itemTypes.TITLE: return titleEmbed(item.uuid, item.price, interaction, VPemojiString);
        default: return basicEmbed(s(interaction).error.UNKNOWN_ITEM_TYPE.f({t: item.type}));
    }
}

const skinEmbed = async (uuid, price, interaction, VPemojiString) => {
    const skin = await getSkin(uuid);
    const colorMap = {
      '0cebb8be-46d7-c12a-d306-e9907bfc5a25': 0x009984,
      'e046854e-406c-37f4-6607-19a9ba8426fc': 0xf99358,
      '60bca009-4182-7998-dee7-b8a2558dc369': 0xd1538c,
      '12683d76-48d7-84a3-4e09-6985794f0445': 0x5a9fe1,
      '411e4a55-4e59-7757-41f0-86a53f101bb5': 0xf9d563
    };

    const color = colorMap[skin.rarity] || '000000'; // default to black
    return {
        title: await skinNameAndEmoji(skin, interaction.channel, interaction),
        url: config.linkItemImage ? skin.icon : null,
        description: priceDescription(VPemojiString, price),
        color: color,
        thumbnail: {
            url: skin.icon
        }
    };
}

const buddyEmbed = async (uuid, price, locale, VPemojiString) => {
    const buddy = await getBuddy(uuid);
    return {
        title: l(buddy.names, locale),
        url: config.linkItemImage ? buddy.icon : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: buddy.icon
        }
    }
}

const cardEmbed = async (uuid, price, locale, VPemojiString) => {
    const card = await getCard(uuid);
    return {
        title: l(card.names, locale),
        url: config.linkItemImage ? card.icons.large : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: card.icons.large
        }
    }
}

const sprayEmbed = async (uuid, price, locale, VPemojiString) => {
    const spray = await getSpray(uuid);
    return {
        title: l(spray.names, locale),
        url: config.linkItemImage ? spray.icon : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: spray.icon
        }
    }
}

const titleEmbed = async (uuid, price, locale, VPemojiString) => {
    const title = await getTitle(uuid);
    return {
        title: l(title.names, locale),
        description: "`" + title.text + "`\n\n" + (priceDescription(VPemojiString, price) || ""),
        color: VAL_COLOR_2,
    }
}

export const skinCollectionSingleEmbed = async (interaction, id, user, {loadout, favorites}) => {
    const someoneElseUsedCommand = interaction.message ?
        interaction.message.interaction && interaction.message.interaction.user.id !== user.id :
        interaction.user.id !== user.id;

    let totalValue = 0;

    const createField = async (weaponUuid, inline=true) => {
        const weapon = await getWeapon(weaponUuid);
        const skin = await getSkinFromSkinUuid(loadout.Guns.find(gun => gun.ID === weaponUuid).SkinID);

        totalValue += skin.price;

        const starEmoji = favorites.FavoritedContent[skin.skinUuid] ? "⭐ " : "";
        return {
            name: l(weapon.names, interaction),
            value: `${starEmoji}${await skinNameAndEmoji(skin, interaction.channel, interaction)}`,
            inline: inline
        }
    }

    const emptyField = {
        name: "\u200b",
        value: "\u200b",
        inline: true
    }

    const fields = [
        await createField(WeaponTypeUuid.Vandal),
        await createField(WeaponTypeUuid.Phantom),
        await createField(WeaponTypeUuid.Operator),

        await createField(WeaponTypeUuid.Knife),
        await createField(WeaponTypeUuid.Sheriff),
        await createField(WeaponTypeUuid.Spectre),

        await createField(WeaponTypeUuid.Classic),
        await createField(WeaponTypeUuid.Ghost),
        await createField(WeaponTypeUuid.Frenzy),

        await createField(WeaponTypeUuid.Bulldog),
        await createField(WeaponTypeUuid.Guardian),
        await createField(WeaponTypeUuid.Marshal),

        await createField(WeaponTypeUuid.Stinger),
        await createField(WeaponTypeUuid.Ares),
        await createField(WeaponTypeUuid.Odin),

        await createField(WeaponTypeUuid.Shorty),
        await createField(WeaponTypeUuid.Bucky),
        await createField(WeaponTypeUuid.Judge),
    ]

    const emoji = await VPEmoji(interaction);
    fields.push(emptyField, {
        name: s(interaction).info.COLLECTION_VALUE,
        value: `${emoji} ${totalValue}`,
        inline: true
    }, emptyField);

    let usernameText;
    if(someoneElseUsedCommand) {
        usernameText = `<@${id}>`;

        const json = readUserJson(id);
        if(json.accounts.length > 1) usernameText += ' ' + s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: json.currentAccount});
    }
    else usernameText = user.username;


    const embed = {
        description: s(interaction).info.COLLECTION_HEADER.f({u: usernameText}, id),
        color: VAL_COLOR_1,
        fields: fields
    }

    const components = [new ActionRowBuilder().addComponents(collectionSwitchEmbedButton(interaction, true, id)),]
    if(!someoneElseUsedCommand) components.push(...switchAccountButtons(interaction, "cl", false, id))

    return {
        embeds: [embed],
        components: components
    }
}

export const skinCollectionPageEmbed = async (interaction, id, user, {loadout, favorites}, pageIndex=0) => {
    const someoneElseUsedCommand = interaction.message ?
        interaction.message.interaction && interaction.message.interaction.user.id !== user.id :
        interaction.user.id !== user.id;

    let totalValue = 0;
    const emoji = await VPEmoji(interaction);


    const createEmbed = async (weaponUuid) => {
        const weapon = await getWeapon(weaponUuid);
        const skin = await getSkinFromSkinUuid(loadout.Guns.find(gun => gun.ID === weaponUuid).SkinID);

        totalValue += skin.price;

        const starEmoji = favorites.FavoritedContent[skin.skinUuid] ? " ⭐" : "";
        return {
            title: l(weapon.names, interaction),
            description: `**${await skinNameAndEmoji(skin, interaction.channel, interaction)}**${starEmoji}\n${emoji} ${skin.price || 'N/A'}`,
            color: VAL_COLOR_2,
            thumbnail: {
                url: skin.icon
            }
        }
    }

    const pages = [
        [WeaponTypeUuid.Vandal, WeaponTypeUuid.Phantom, WeaponTypeUuid.Operator, WeaponTypeUuid.Knife],
        [WeaponTypeUuid.Classic, WeaponTypeUuid.Sheriff, WeaponTypeUuid.Spectre, WeaponTypeUuid.Marshal],
        [WeaponTypeUuid.Frenzy, WeaponTypeUuid.Ghost, WeaponTypeUuid.Bulldog, WeaponTypeUuid.Guardian],
        [WeaponTypeUuid.Shorty, WeaponTypeUuid.Bucky, WeaponTypeUuid.Judge],
        [WeaponTypeUuid.Stinger, WeaponTypeUuid.Ares, WeaponTypeUuid.Odin],
    ];

    if(pageIndex < 0) pageIndex = pages.length - 1;
    if(pageIndex >= pages.length) pageIndex = 0;

    let usernameText;
    if(someoneElseUsedCommand) {
        usernameText = `<@${id}>`;

        const json = readUserJson(id);
        if(json.accounts.length > 1) usernameText += ' ' + s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: json.currentAccount});
    }
    else usernameText = user.username;

    const embeds = [basicEmbed(s(interaction).info.COLLECTION_HEADER.f({u: usernameText}, id))];
    for(const weapon of pages[pageIndex]) {
        embeds.push(await createEmbed(weapon));
    }

    const firstRowButtons = [collectionSwitchEmbedButton(interaction, false, id)];
    firstRowButtons.push(...(pageButtons("clpage", id, pageIndex, pages.length).components))

    const components = [new ActionRowBuilder().setComponents(...firstRowButtons)]
    if(!someoneElseUsedCommand) components.push(...switchAccountButtons(interaction, "cl", false, id));

    return {embeds, components}
}

const collectionSwitchEmbedButton = (interaction, switchToPage, id) => {
    const label = s(interaction).info[switchToPage ? "COLLECTION_VIEW_IMAGES" : "COLLECTION_VIEW_ALL"];
    const customId = `clswitch/${switchToPage ? "p" : "s"}/${id}`;
    return new ButtonBuilder().setEmoji('🔍').setLabel(label).setStyle(ButtonStyle.Primary).setCustomId(customId);
}

export const collectionOfWeaponEmbed = async (interaction, id, user, weaponTypeUuid, skins, pageIndex=0) => {
    const someoneElseUsedCommand = interaction.message ?
        interaction.message.interaction && interaction.message.interaction.user.id !== user.id :
        interaction.user.id !== user.id;

    const emoji = await VPEmoji(interaction);

    let usernameText;
    if(someoneElseUsedCommand) {
        usernameText = `<@${id}>`;

        const json = readUserJson(id);
        if(json.accounts.length > 1) usernameText += ' ' + s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: json.currentAccount});
    }
    else usernameText = user.username;

    // note: some of these are null for some reason
    const skinsData = await Promise.all(skins.map(skinUuid => getSkin(skinUuid, false)));
    const filteredSkins = skinsData.filter(skin => skin?.weapon === weaponTypeUuid);
    filteredSkins.sort((a, b) => { // sort by price, then rarity
        const priceDiff = (b.price || 0) - (a.price || 0);
        if(priceDiff !== 0) return priceDiff;

        const rarityOrder = [
            "12683d76-48d7-84a3-4e09-6985794f0445", // select
            "0cebb8be-46d7-c12a-d306-e9907bfc5a25", // deluxe
            "60bca009-4182-7998-dee7-b8a2558dc369", // premium
            "411e4a55-4e59-7757-41f0-86a53f101bb5", // ultra
            "e046854e-406c-37f4-6607-19a9ba8426fc", // exclusive
        ];
        return rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity);
    });

    const embedsPerPage = 5;
    const maxPages = Math.ceil(filteredSkins.length / embedsPerPage);

    if(pageIndex < 0) pageIndex = maxPages - 1;
    if(pageIndex >= maxPages) pageIndex = 0;

    const weaponName = await getWeapon(weaponTypeUuid).then(weapon => l(weapon.names, interaction));
    const embeds = [basicEmbed(s(interaction).info.COLLECTION_WEAPON_HEADER.f({u: usernameText, w: weaponName, p: pageIndex + 1, t: maxPages}, id))];
    const skinEmbed = async (skin) => ({
        title: await skinNameAndEmoji(skin, interaction.channel, interaction),
        description: `${emoji} ${skin.price || 'N/A'}`,
        color: VAL_COLOR_2,
        thumbnail: {
            url: skin.icon
        }
    })
    if(filteredSkins.length === 0) {
        const weapon = await getWeapon(weaponTypeUuid);
        const skin = await getSkinFromSkinUuid(weapon.defaultSkinUuid);
        embeds.push(await skinEmbed(skin));
    }
    else for(const skin of filteredSkins.slice(pageIndex * embedsPerPage, (pageIndex + 1) * embedsPerPage)) {
        embeds.push(await skinEmbed(skin));
    }

    const weaponTypeIndex = Object.values(WeaponTypeUuid).indexOf(weaponTypeUuid);

    const actionRows = [];
    if(maxPages > 1) actionRows.push(pageButtons(`clwpage/${weaponTypeIndex}`, id, pageIndex, maxPages));
    if(!someoneElseUsedCommand) actionRows.push(...switchAccountButtons(interaction, `clw-${weaponTypeIndex}`, false, id));

    return {embeds, components: actionRows}
}

export const botInfoEmbed = (interaction, client, guildCount, userCount, registeredUserCount, ownerString, status) => {
    const fields = [
        {
            name: s(interaction).info.INFO_SERVERS,
            value: guildCount.toString(),
            inline: true
        },
        {
            name: s(interaction).info.INFO_MEMBERS,
            value: userCount.toString(),
            inline: true
        },
        {
            name: s(interaction).info.INFO_REGISTERED,
            value: registeredUserCount.toString(),
            inline: true
        },
        {
            name: ":dog2:",
            value: s(interaction).info.INFO_WOOF,
            inline: true
        },
        {
            name: s(interaction).info.INFO_SOURCE,
            value: "[SkinPeek](https://github.com/giorgi-o/SkinPeek) by [Giorgio](https://github.com/giorgi-o)",
            inline: true
        }
    ];
    if(ownerString) fields.push({
        name: s(interaction).info.INFO_OWNER,
        value: ownerString || "Giorgio#0609",
        inline: true
    });
    if(interaction.client.shard) fields.push({
        name: "Running on shard",
        value: interaction.client.shard.ids.join(' ') || "No shard id...?",
        inline: true
    });
    if(status) fields.push({
        name: s(interaction).info.INFO_STATUS,
        value: status || "Up and running!",
        inline: true
    });

    const readyTimestamp = Math.round(client.readyTimestamp / 1000);

    return {
        embeds: [{
            title: s(interaction).info.INFO_HEADER,
            description: s(interaction).info.INFO_RUNNING.f({t1: readyTimestamp, t2: readyTimestamp}),
            color: VAL_COLOR_1,
            fields: fields
        }]
    }
}

export const ownerMessageEmbed = (messageContent, author) => {
    return {
        title: "Message from bot owner:",
        description: messageContent,
        color: VAL_COLOR_3,
        footer: {
            text: "By " + author.username,
            icon_url: author.displayAvatarURL()
        }
    }
}

const priceDescription = (VPemojiString, price) => {
    if(price) return `${VPemojiString} ${price}`;
}

const pageButtons = (pageId, userId, current, max) => {
    const leftButton = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setEmoji("◀").setCustomId(`${pageId}/${userId}/${current - 1}`);
    const rightButton = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setEmoji("▶").setCustomId(`${pageId}/${userId}/${current + 1}`);

    if(current === 0) leftButton.setEmoji("⏪");
    if(current === max - 1) rightButton.setEmoji("⏩");

    return new ActionRowBuilder().setComponents(leftButton, rightButton);
}

export const switchAccountButtons = (interaction, customId, oneAccountButton=false, id=interaction?.user?.id || interaction) => {
    const json = removeDupeAccounts(id);
    if(!json || json.accounts.length === 1 && !oneAccountButton) return [];
    const accountNumbers = [...Array(json.accounts.length).keys()].map(n => n + 1).slice(0, 5);
    const hideIgn = getSetting(id, "hideIgn");

    const buttons = [];
    for(const number of accountNumbers) {
        const username = json.accounts[number - 1].username || s(interaction).info.NO_USERNAME;
        const label = hideIgn ? s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: number.toString()}) : username;

        const button = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(label).setCustomId(`account/${customId}/${id}/${number}`);
        button.setDisabled(number === json.currentAccount);

        buttons.push(button);
    }

    return [new ActionRowBuilder().setComponents(...buttons)];
}

const alertFieldDescription = async (interaction, channel_id, emojiString, price) => {
    if(channel_id === interaction.channelId) {
        if(price) return `${emojiString} ${price}`;
        if(config.fetchSkinPrices) return s(interaction).info.SKIN_NOT_FOR_SALE;
        return s(interaction).info.SKIN_PRICES_HIDDEN;
    } else {
        const channel = await fetchChannel(channel_id);
        if(channel && !channel.guild) return s(interaction).info.ALERT_IN_DM_CHANNEL;
        return s(interaction).info.ALERT_IN_CHANNEL.f({c: channel_id})
    }
}

export const alertsPageEmbed = async (interaction, alerts, pageIndex, emojiString) => {
    const components = switchAccountButtons(interaction, "alerts");

    alerts = alerts.filter(alert => alert.uuid);

    if(alerts.length === 0) {
        return {
            embeds: [basicEmbed(s(interaction).error.NO_ALERTS)],
            components: components
        }
    }

    if(alerts.length === 1) {
        const alert = alerts[0];

        const skin = await getSkin(alert.uuid);

        return {
            embeds: [{
                title: s(interaction).info.ONE_ALERT,
                color: VAL_COLOR_1,
                description: `**${await skinNameAndEmoji(skin, interaction.channel, interaction)}**\n${await alertFieldDescription(interaction, alert.channel_id, emojiString, skin.price)}`,
                thumbnail: {
                    url: skin.icon
                }
            }],
            components: [removeAlertActionRow(interaction.user.id, alert.uuid, s(interaction).info.REMOVE_ALERT_BUTTON)].concat(components),
            ephemeral: true
        }
    }

    const maxPages = Math.ceil(alerts.length / config.alertsPerPage);

    if(pageIndex < 0) pageIndex = maxPages - 1;
    if(pageIndex >= maxPages) pageIndex = 0;

    const embed = { // todo switch this to a "one embed per alert" message, kinda like /shop
        title: s(interaction).info.MULTIPLE_ALERTS,
        color: VAL_COLOR_1,
        footer: {
            text: s(interaction).info.REMOVE_ALERTS_FOOTER
        },
        fields: []
    }
    const buttons = [];

    let n = pageIndex * config.alertsPerPage;
    const alertsToRender = alerts.slice(n, n + config.alertsPerPage);
    for(const alert of alertsToRender) {
        const skin = await getSkin(alert.uuid);
        embed.fields.push({
            name: `**${n+1}.** ${await skinNameAndEmoji(skin, interaction.channel, interaction)}`,
            value: await alertFieldDescription(interaction, alert.channel_id, emojiString, skin.price),
            inline: alerts.length > 5
        });
        buttons.push(removeAlertButton(interaction.user.id, alert.uuid, `${n+1}.`));
        n++;
    }

    const actionRows = [];
    for(let i = 0; i < alertsToRender.length; i += 5) {
        const actionRow = new ActionRowBuilder();
        for(let j = i; j < i + 5 && j < alertsToRender.length; j++) {
            actionRow.addComponents(buttons[j]);
        }
        actionRows.push(actionRow);
    }
    if(maxPages > 1) actionRows.push(pageButtons("changealertspage", interaction.user.id, pageIndex, maxPages));

    if(actionRows.length < 5) actionRows.push(...components);

    return {
        embeds: [embed],
        components: actionRows
    }
}

export const alertTestResponse = async (interaction, success) => {
    if(success) {
        await interaction.followUp({
            embeds: [secondaryEmbed(s(interaction).info.ALERT_TEST_SUCCESSFUL)]
        });
    } else {
        await interaction.followUp({
            embeds: [basicEmbed(s(interaction).error.ALERT_NO_PERMS)]
        });
    }
}

export const allStatsEmbed = async (interaction, stats, pageIndex=0) => {
    const skinCount = Object.keys(stats.items).length;

    if(skinCount === 0) return {
        embeds: [basicEmbed(config.trackStoreStats ? s(interaction).error.EMPTY_STATS : s(interaction).error.STATS_DISABLED)]
    }

    const maxPages = Math.ceil(skinCount / config.statsPerPage);

    if(pageIndex < 0) pageIndex = maxPages - 1;
    if(pageIndex >= maxPages) pageIndex = 0;

    const skinsToDisplay = Object.keys(stats.items).slice(pageIndex * config.statsPerPage, pageIndex * config.statsPerPage + config.statsPerPage);
    const embeds = [basicEmbed(s(interaction).info.STATS_HEADER.f({c: stats.shopsIncluded, p: pageIndex + 1, t: maxPages}))];
    for(const uuid of skinsToDisplay) {
        const skin = await getSkin(uuid);
        const statsForSkin = getStatsFor(uuid);
        embeds.push(await statsForSkinEmbed(skin, statsForSkin, interaction));
    }

    return {
        embeds: embeds,
        components: [pageButtons("changestatspage", interaction.user.id, pageIndex, maxPages)]
    }
}

export const statsForSkinEmbed = async (skin, stats, interaction) => {
    let description;
    if(stats.count === 0) description = s(interaction).error.NO_STATS_FOR_SKIN.f({d: config.statsExpirationDays || '∞'});
    else {
        const percentage = Math.round(stats.count / stats.shopsIncluded * 100 * 100) / 100;
        const crownEmoji = stats.rank[0] === 1 || stats.rank[0] === stats.rank[1] ? ':crown: ' : '';
        description = s(interaction).info.STATS_DESCRIPTION.f({c: crownEmoji, r: stats.rank[0], t: stats.rank[1], p: percentage});
    }

    return {
        title: await skinNameAndEmoji(skin, interaction.channel, interaction),
        description: description,
        color: VAL_COLOR_2,
        thumbnail: {
            url: skin.icon
        }
    }
}

export const accountsListEmbed = (interaction, userJson) => {
    const fields = [];
    for(const [i, account] of Object.entries(userJson.accounts)) {
        let fieldValue;
        if(!account.username) fieldValue = s(interaction).info.NO_USERNAME;
        else fieldValue = account.username;

        fields.push({
            name: `${parseInt(i) + 1}. ${userJson.currentAccount === parseInt(i) + 1 ? s(interaction).info.ACCOUNT_CURRENTLY_SELECTED : ''}`,
            value: fieldValue,
            inline: true
        });
    }

    const hideIgn = getSetting(interaction.user.id, "hideIgn");

    return {
        embeds: [{
            title: s(interaction).info.ACCOUNTS_HEADER,
            fields: fields,
            color: VAL_COLOR_1
        }],
        ephemeral: hideIgn
    }
}

export const settingsEmbed = (userSettings, interaction) => {
    const embed = {
        title: s(interaction).settings.VIEW_HEADER,
        description: s(interaction).settings.VIEW_DESCRIPTION,
        color: VAL_COLOR_1,
        fields: []
    }

    for(const [setting, value] of Object.entries(userSettings)) {
        if(!settingIsVisible(setting)) continue;

        let displayValue = humanifyValue(
            setting === "locale" && !userSettings.localeForced ? "Automatic" : value,
            setting, interaction, true
        );

        embed.fields.push({
            name: settingName(setting, interaction),
            value: displayValue,
            inline: true
        });
    }

    return {
        embeds: [embed]
    }
}

export const valMaintenancesEmbeds = (interaction, {maintenances, incidents, id: regionName}) => {
    const embeds = [];
    for(const maintenance of maintenances) {
        embeds.push(valMaintenanceEmbed(interaction, maintenance, false, regionName));
    }
    for(const incident of incidents) {
        embeds.push(valMaintenanceEmbed(interaction, incident, true, regionName));
    }

    if(!embeds.length) {
        embeds.push(basicEmbed(s(interaction).info.NO_MAINTENANCES.f({r: regionName})));
    }

    return {
        embeds: embeds
    }
}

export const valMaintenanceEmbed = (interaction, target, isIncident, regionName) => {
    const update = target.updates[0] || {};
    const strings = update.translations || target.titles;
    const string = (strings.find(s => s.locale.replace('_', '-') === (discToValLang[interaction.locale] || DEFAULT_VALORANT_LANG)) || strings[0]).content;
    const lastUpdate = Math.round(new Date(update.created_at || target.created_at) / 1000);
    const targetType = isIncident ? s(interaction).info.INCIDENT_TYPE : s(interaction).info.MAINTENANCE_TYPE;

    return {
        title: s(interaction).info.MAINTENANCE_HEADER.f({t: targetType, r: regionName}),
        description: `> ${string}\n*${s(interaction).info.LAST_UPDATED.f({t: lastUpdate})}*`,
    }
}

export const basicEmbed = (content) => {
    return {
        description: content,
        color: VAL_COLOR_1
    }
}

export const headerEmbed = (content) => {
  return {
    description: content,
    color: 0x202225,
  };
};

export const secondaryEmbed = (content) => {
    return {
        description: content,
        color: VAL_COLOR_2
    }
}

const createProgressBar = (totalxpneeded, currentxp, level) => {
    const length = 14;
    const totalxp = Number(totalxpneeded.replace(',', '')) + Number(currentxp)

    const index = Math.min(Math.round(currentxp / totalxp * length), length);

    const line = '▬';
    const circle = '⬤';

    const bar = line.repeat(Math.max(index, 0)) + circle + line.repeat(Math.max(length - index, 0));

    return level + '┃' + bar + '┃' + (Number(level) + 1);
}
