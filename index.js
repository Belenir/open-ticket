const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const http = require('http');

// 1. Создаем веб-заглушку для хостинга Render, чтобы он не выдавал ошибки портов
http.createServer((req, res) => res.end('Бот активен!')).listen(process.env.PORT || 10000);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// СЮДА ВСТАВЬТЕ ID ВАШИХ КАНАЛОВ ИЗ DISCORD
const CONFIG = {
    BUTTON_CHANNEL_ID: "1548418283148017837", 
    ADMIN_CHANNEL_ID: "1548418283148017837" 
};

client.once('ready', () => {
    console.log(`🤖 Бот успешно запущен под именем: ${client.user.tag}`);
});

// Слушаем текстовые команды (для вызова кнопки администратором)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Введите в чат !форма, чтобы бот выслал кнопку заполнения
    if (message.content === '!форма') {
        // Проверяем, в том ли канале администратор пишет команду
        if (message.channel.id !== CONFIG.BUTTON_CHANNEL_ID) {
            return message.reply(`Эту команду нужно вводить в канале, где должна стоять кнопка!`);
        }

        const embed = new EmbedBuilder()
            .setTitle('✨ Подача заявки / Заполнение анкеты ✨')
            .setDescription('Нажмите на кнопку ниже, чтобы открыть и заполнить форму анкеты прямо на сервере.')
            .setColor('#2ecc71');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_open_anketa')
                .setLabel('Заполнить анкету')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📝')
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(() => {}); // Удаляем команду администратора для чистоты
    }
});

// Слушаем нажатия на кнопку и отправку модального окна
client.on('interactionCreate', async (interaction) => {
    // 1. Клик по кнопке -> Открываем модальное окно
    if (interaction.isButton() && interaction.customId === 'btn_open_anketa') {
        const modal = new ModalBuilder()
            .setCustomId('mdl_anketa')
            .setTitle('Заполнение формы');

        const t1 = new TextInputBuilder().setCustomId('inp_text1').setLabel('Текстовое поле №1').setStyle(TextInputStyle.Short).setRequired(true);
        const t2 = new TextInputBuilder().setCustomId('inp_text2').setLabel('Текстовое поле №2').setStyle(TextInputStyle.Short).setRequired(true);
        const date = new TextInputBuilder().setCustomId('inp_date').setLabel('Дата (ДД.ММ.ГГГГ)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('13.09.2026');
        const variant = new TextInputBuilder().setCustomId('inp_variant').setLabel('Вариант (А, Б или В)').setStyle(TextInputStyle.Short).setRequired(true);
        const img = new TextInputBuilder().setCustomId('inp_img').setLabel('Ссылка на картинку/скриншот').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('https://...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(t1),
            new ActionRowBuilder().addComponents(t2),
            new ActionRowBuilder().addComponents(date),
            new ActionRowBuilder().addComponents(variant),
            new ActionRowBuilder().addComponents(img)
        );

        await interaction.showModal(modal);
    }

    // 2. Пользователь нажал "Отправить" в окне -> Собираем и шлем админам
    if (interaction.isModalSubmit() && interaction.customId === 'mdl_anketa') {
        const text1 = interaction.fields.getTextInputValue('inp_text1');
        const text2 = interaction.fields.getTextInputValue('inp_text2');
        const date = interaction.fields.getTextInputValue('inp_date');
        const variant = interaction.fields.getTextInputValue('inp_variant');
        const imgUrl = interaction.fields.getTextInputValue('inp_img');

        // Отправляем пользователю личное скрытое уведомление
        await interaction.reply({ content: '🎉 Спасибо! Ваша анкета успешно отправлена администрации сервера.', ephemeral: true });

        // Отправляем красивый Embed в канал администрации
        const adminChannel = client.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
        if (adminChannel) {
            const adminEmbed = new EmbedBuilder()
                .setTitle(`📥 Получена новая анкета от ${interaction.user.username}`)
                .setColor('#3498db')
                .addFields(
                    { name: 'Текст 1', value: text1, inline: false },
                    { name: 'Текст 2', value: text2, inline: false },
                    { name: 'Дата', value: date, inline: true },
                    { name: 'Вариант', value: variant, inline: true }
                )
                .setFooter({ text: `ID пользователя: ${interaction.user.id}` })
                .setTimestamp();

            // Если пользователь вставил ссылку на картинку, добавляем её в Embed
            if (imgUrl && (imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))) {
                adminEmbed.setImage(imgUrl);
            }

            await adminChannel.send({ embeds: [adminEmbed] });
        }
    }
});

client.login(process.env.TOKEN);
