const config = {
    type: Phaser.AUTO,
    parent: "game-container",
    title: "Home Builder - Gather Style",
    version: "1.0.0",
    autoFocus: true,
    disableContextMenu: false,
    scale: { 
        mode: Phaser.Scale.RESIZE, 
        autoCenter: Phaser.Scale.CENTER_BOTH 
    },
    audio: { noAudio: true },
    backgroundColor: 0xf5f5f5,
    antialias: true,
    pixelArt: false,
    roundPixels: false,
    transparent: false,
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);

let graphics;
let gridGraphics;
let tooltipText;
let apiData = [];
let selectedItemType = null;
let selectedObject = null;
let placedObjects = [];
let currentMaxDepth = 1;
let uploadedImages = []; // เก็บข้อมูลรูปภาพที่อัปโหลด
let selectedImageIndex = null; // รูปภาพที่เลือกไว้สำหรับวาง
let gameScene = null; // เก็บ scene reference
let draggingObject = null; // วัตถุที่กำลังลากด้วยเมาส์กลาง
let dragOffset = { x: 0, y: 0 }; // offset สำหรับการลาก

// กำหนดขนาดและสีของวัตถุแต่ละประเภท
const itemConfigs = {
    // ห้อง
    'room': { width: 256, height: 192, color: 0xe8e8e8, strokeColor: 0x888888 },
    
    // ผนัง
    'wall-h': { width: 128, height: 8, color: 0x8b7355, strokeColor: 0x5a4a3a },
    'wall-v': { width: 8, height: 128, color: 0x8b7355, strokeColor: 0x5a4a3a },
    
    // เฟอร์นิเจอร์
    'table': { width: 80, height: 60, color: 0x8B4513, strokeColor: 0x654321 },
    'chair': { width: 40, height: 40, color: 0x654321, strokeColor: 0x3d2817 },
    'sofa': { width: 120, height: 60, color: 0x8B4513, strokeColor: 0x654321 },
    'bed': { width: 160, height: 120, color: 0x4169E1, strokeColor: 0x2E4A8F },
    'desk': { width: 100, height: 50, color: 0x8B4513, strokeColor: 0x654321 },
    
    // ของตกแต่ง
    'plant': { width: 32, height: 48, color: 0x228B22, strokeColor: 0x006400 },
    'lamp': { width: 24, height: 40, color: 0xFFD700, strokeColor: 0xDAA520 },
    'picture': { width: 60, height: 80, color: 0xD3D3D3, strokeColor: 0x808080 }
};

function preload() {
    // ไม่ต้องโหลดอะไร เพราะใช้ graphics วาดแทน
}

async function create() {
    gameScene = this;
    graphics = this.add.graphics();
    gridGraphics = this.add.graphics();
    
    drawGrid(this.scale.width, this.scale.height);
    this.scale.on('resize', (gameSize) => drawGrid(gameSize.width, gameSize.height));

    tooltipText = this.add.text(0, 0, '', { 
        font: "14px Arial", 
        fill: "#000", 
        backgroundColor: "#fff",
        padding: { x: 5, y: 5 }
    });
    tooltipText.setDepth(10000);
    tooltipText.setVisible(false);

    // Zoom controls
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
        if (pointer.event.ctrlKey || pointer.event.metaKey) {
            pointer.event.preventDefault();
            const zoomAmount = deltaY < 0 ? 0.1 : -0.1;
            const newZoom = this.cameras.main.zoom + zoomAmount;
            if (newZoom >= 0.5 && newZoom <= 3) {
                this.cameras.main.zoom = newZoom;
            }
        }
    });

    // คลิกเพื่อวางวัตถุ และป้องกันการ scroll เมื่อกดเมาส์กลาง
    this.input.on('pointerdown', (pointer) => {
        const isMiddleButton = pointer.event.button === 1 || pointer.event.which === 2;
        
        // ป้องกันการ scroll ของเบราว์เซอร์เมื่อกดเมาส์กลาง
        if (isMiddleButton) {
            pointer.event.preventDefault();
        }
        
        // คลิกซ้ายเพื่อวางวัตถุ
        if (pointer.leftButtonDown() && selectedItemType) {
            placeObject(this, pointer.worldX, pointer.worldY, selectedItemType);
        } else if (pointer.rightButtonDown()) {
            // คลิกขวาเพื่อเลือกวัตถุ
            selectObjectAt(this, pointer.worldX, pointer.worldY);
        }
    });

    // ลากวัตถุด้วยเมาส์กลาง
    this.input.on('pointermove', (pointer) => {
        if (draggingObject) {
            // ตรวจสอบว่าเมาส์กลางยังกดอยู่หรือไม่ (buttons === 4 คือ middle button)
            const isMiddleButtonDown = pointer.event.buttons === 4;
            
            if (isMiddleButtonDown) {
                const worldPoint = pointer.positionToCamera(this.cameras.main);
                let newX = worldPoint.x - dragOffset.x;
                let newY = worldPoint.y - dragOffset.y;
                
                if (pointer.event.ctrlKey || pointer.event.metaKey) {
                    // Snap to grid
                    newX = Phaser.Math.Snap.To(newX, 64);
                    newY = Phaser.Math.Snap.To(newY, 64);
                }
                
                draggingObject.x = newX;
                draggingObject.y = newY;
                
                // อัพเดต outline ถ้ามี
                if (draggingObject.selectionOutline) {
                    const bounds = draggingObject.getBounds();
                    draggingObject.selectionOutline.clear();
                    draggingObject.selectionOutline.lineStyle(3, 0x00ff00, 1);
                    draggingObject.selectionOutline.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
                }
            } else {
                // ถ้าไม่ได้กดเมาส์กลางแล้ว ให้หยุดลาก
                draggingObject = null;
                this.input.setDefaultCursor('default');
            }
        }
    });

    // ปล่อยเมาส์กลาง
    this.input.on('pointerup', (pointer) => {
        // ตรวจสอบว่าเป็นเมาส์กลาง (button 1)
        const isMiddleButton = pointer.event.button === 1 || pointer.event.which === 2;
        
        if (isMiddleButton && draggingObject) {
            draggingObject = null;
            this.input.setDefaultCursor('default');
        }
    });

    // ลบวัตถุที่เลือกด้วย Delete key
    this.input.keyboard.on('keydown-DELETE', () => {
        if (selectedObject) {
            deleteObject(this, selectedObject);
        }
    });

    // Setup toolbar buttons
    setupToolbarButtons(this);
    
    // Setup image upload
    setupImageUpload(this);

    // ดึงข้อมูล API (ถ้ามี)
    try {
        apiData = await fetch5SData();
    } catch (err) {
        console.log('API data not available:', err);
        apiData = [];
    }
}

function update() {
    // อัพเดต tooltip ตำแหน่งตามเมาส์
    if (tooltipText.visible) {
        const pointer = this.input.activePointer;
        tooltipText.setPosition(pointer.x + 15, pointer.y + 15);
    }
}

function drawGrid(width, height) {
    gridGraphics.clear();
    gridGraphics.lineStyle(1, 0xcccccc, 0.3);
    
    const gridSize = 64;
    for (let x = 0; x < width; x += gridSize) {
        gridGraphics.moveTo(x, 0);
        gridGraphics.lineTo(x, height);
    }
    for (let y = 0; y < height; y += gridSize) {
        gridGraphics.moveTo(0, y);
        gridGraphics.lineTo(width, y);
    }
    gridGraphics.strokePath();
}

function setupToolbarButtons(scene) {
    const buttons = document.querySelectorAll('.item-button');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            // ลบ active class จากปุ่มอื่น
            buttons.forEach(btn => btn.classList.remove('active'));
            
            const itemType = button.getAttribute('data-type');
            
            if (itemType === 'clear') {
                clearAllObjects(scene);
                selectedItemType = null;
            } else if (itemType === 'delete') {
                selectedItemType = 'delete';
                button.classList.add('active');
            } else if (itemType === 'custom-image') {
                // ตรวจสอบว่ามีรูปภาพที่เลือกไว้หรือไม่
                if (selectedImageIndex !== null && uploadedImages[selectedImageIndex]) {
                    selectedItemType = 'custom-image';
                    button.classList.add('active');
                } else {
                    alert('กรุณาเลือกรูปภาพก่อนวาง');
                }
            } else {
                selectedItemType = itemType;
                button.classList.add('active');
            }
        });
    });
}

function setupImageUpload(scene) {
    const uploadBtn = document.getElementById('uploadBtn');
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');

    uploadBtn.addEventListener('click', () => {
        imageUpload.click();
    });

    imageUpload.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const imageData = {
                        name: file.name,
                        dataUrl: event.target.result,
                        textureKey: `custom-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                    };
                    
                    // โหลดรูปภาพเข้า Phaser texture โดยใช้ addBase64
                    const img = new Image();
                    img.onload = () => {
                        // ใช้ texture.addBase64 เพื่อโหลดรูปภาพทันที
                        scene.textures.addBase64(imageData.textureKey, imageData.dataUrl);
                        uploadedImages.push(imageData);
                        updateImagePreview();
                    };
                    img.onerror = () => {
                        alert('ไม่สามารถโหลดรูปภาพได้: ' + file.name);
                    };
                    img.src = imageData.dataUrl;
                };
                reader.readAsDataURL(file);
            }
        });
        // Reset input เพื่อให้สามารถเลือกไฟล์เดิมได้อีก
        e.target.value = '';
    });
}

function updateImagePreview() {
    const imagePreview = document.getElementById('imagePreview');
    imagePreview.innerHTML = '';

    uploadedImages.forEach((imageData, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        if (index === selectedImageIndex) {
            previewItem.classList.add('selected');
        }

        const img = document.createElement('img');
        img.src = imageData.dataUrl;
        img.alt = imageData.name;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'ลบรูปภาพ';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeImage(index);
        };

        previewItem.appendChild(img);
        previewItem.appendChild(removeBtn);
        previewItem.onclick = () => {
            selectImage(index);
        };

        imagePreview.appendChild(previewItem);
    });
}

function selectImage(index) {
    selectedImageIndex = index;
    updateImagePreview();
    
    // อัพเดตปุ่มวางรูปภาพ
    const customImageBtn = document.querySelector('[data-type="custom-image"]');
    if (customImageBtn) {
        document.querySelectorAll('.item-button').forEach(btn => btn.classList.remove('active'));
        customImageBtn.classList.add('active');
        selectedItemType = 'custom-image';
    }
}

function removeImage(index) {
    if (gameScene && uploadedImages[index]) {
        const imageData = uploadedImages[index];
        // ลบ texture จาก Phaser
        if (gameScene.textures.exists(imageData.textureKey)) {
            gameScene.textures.remove(imageData.textureKey);
        }
    }
    
    uploadedImages.splice(index, 1);
    
    if (selectedImageIndex === index) {
        selectedImageIndex = null;
        selectedItemType = null;
        document.querySelectorAll('.item-button').forEach(btn => btn.classList.remove('active'));
    } else if (selectedImageIndex > index) {
        selectedImageIndex--;
    }
    
    updateImagePreview();
}

function placeObject(scene, x, y, itemType) {
    if (itemType === 'delete') {
        // โหมดลบ: ลบวัตถุที่คลิก
        const obj = getObjectAt(scene, x, y);
        if (obj) {
            deleteObject(scene, obj);
        }
        return;
    }

    // ตรวจสอบว่าต้องการวางรูปภาพที่อัปโหลดหรือไม่
    if (itemType === 'custom-image') {
        if (selectedImageIndex === null || !uploadedImages[selectedImageIndex]) {
            alert('กรุณาเลือกรูปภาพก่อนวาง');
            return;
        }
        
        const imageData = uploadedImages[selectedImageIndex];
        if (!scene.textures.exists(imageData.textureKey)) {
            alert('รูปภาพยังไม่พร้อมใช้งาน กรุณารอสักครู่');
            return;
        }
        
        // Snap to grid
        const texture = scene.textures.get(imageData.textureKey);
        const snappedX = Phaser.Math.Snap.To(x, 64);
        const snappedY = Phaser.Math.Snap.To(y, 64);
        
        // สร้าง image object
        const object = scene.add.image(snappedX, snappedY, imageData.textureKey);
        
        // ตั้งขนาดให้เหมาะสม (จำกัดขนาดสูงสุด)
        const maxSize = 128;
        if (texture.source[0].width > maxSize || texture.source[0].height > maxSize) {
            const scale = Math.min(maxSize / texture.source[0].width, maxSize / texture.source[0].height);
            object.setScale(scale);
        }
        
        // ตั้งค่า interactive (ไม่ใช้ draggable เพราะจะใช้เมาส์กลางแทน)
        object.setInteractive({ useHandCursor: true });
        object.setDepth(currentMaxDepth++);
        
    // เก็บข้อมูล
    object.itemType = 'custom-image';
    object.imageData = imageData;
    object.config = { 
        width: object.width, 
        height: object.height,
        strokeColor: 0x00ff00 
    };
    object.selectedItem = null;
    object.selectionOutline = null; // สำหรับเก็บ outline เมื่อเลือก
        
        // Event handlers
        setupObjectEvents(scene, object);
        
        placedObjects.push(object);
        updateObjectTooltip(object);
        
        return;
    }

    const config = itemConfigs[itemType];
    if (!config) return;

    // Snap to grid
    const snappedX = Phaser.Math.Snap.To(x, 64) - config.width / 2;
    const snappedY = Phaser.Math.Snap.To(y, 64) - config.height / 2;

    // สร้างวัตถุ
    let object;
    
    if (itemType === 'room') {
        // ห้องเป็น rectangle พิเศษ
        object = scene.add.rectangle(snappedX + config.width / 2, snappedY + config.height / 2, 
                                     config.width, config.height, config.color);
        object.setStrokeStyle(2, config.strokeColor);
    } else if (itemType.startsWith('wall-')) {
        // ผนัง
        object = scene.add.rectangle(snappedX + config.width / 2, snappedY + config.height / 2,
                                     config.width, config.height, config.color);
        object.setStrokeStyle(1, config.strokeColor);
    } else {
        // เฟอร์นิเจอร์และของตกแต่ง
        object = scene.add.rectangle(snappedX + config.width / 2, snappedY + config.height / 2,
                                     config.width, config.height, config.color);
        object.setStrokeStyle(2, config.strokeColor);
    }

    // ตั้งค่า interactive (ไม่ใช้ draggable เพราะจะใช้เมาส์กลางแทน)
    object.setInteractive({ useHandCursor: true });
    object.setDepth(currentMaxDepth++);
    
    // เก็บข้อมูล
    object.itemType = itemType;
    object.config = config;
    object.selectedItem = null; // สำหรับข้อมูล API ถ้ามี
    
    // Event handlers
    setupObjectEvents(scene, object);
    
    placedObjects.push(object);
    
    // อัพเดต tooltip
    updateObjectTooltip(object);
}

function setupObjectEvents(scene, object) {
    // ลากด้วยเมาส์กลาง
    object.on('pointerdown', (pointer) => {
        // ตรวจสอบเมาส์กลาง (button 1 = middle button)
        const isMiddleButton = pointer.event.button === 1 || pointer.event.which === 2;
        
        if (isMiddleButton) {
            // เริ่มลากด้วยเมาส์กลาง
            draggingObject = object;
            const worldPoint = pointer.positionToCamera(scene.cameras.main);
            dragOffset.x = worldPoint.x - object.x;
            dragOffset.y = worldPoint.y - object.y;
            object.setDepth(currentMaxDepth++);
            selectObject(scene, object);
            scene.input.setDefaultCursor('move');
            // ป้องกัน context menu
            pointer.event.preventDefault();
        } else if (pointer.rightButtonDown()) {
            if (apiData && apiData.length > 0) {
                showDataSelection(scene, object);
            } else {
                selectObject(scene, object);
            }
        } else if (pointer.leftButtonDown()) {
            selectObject(scene, object);
        }
    });

    // Hover
    object.on('pointerover', () => {
        if (object.selectedItem) {
            tooltipText.setText(`${object.selectedItem[0]}\n${object.selectedItem[1]}\n${object.selectedItem[2]}`);
        } else if (object.itemType === 'custom-image') {
            tooltipText.setText(`${object.imageData.name}\nMiddle-click to drag`);
        } else {
            tooltipText.setText(`${object.itemType}\nMiddle-click to drag`);
        }
        tooltipText.setVisible(true);
    });

    object.on('pointerout', () => {
        tooltipText.setVisible(false);
    });
}

function selectObject(scene, object) {
    // ลบการเลือกเดิม
    if (selectedObject && selectedObject !== object) {
        if (selectedObject.itemType === 'custom-image') {
            // ลบ outline การเลือก
            if (selectedObject.selectionOutline) {
                selectedObject.selectionOutline.destroy();
                selectedObject.selectionOutline = null;
            }
        } else {
            const strokeWidth = selectedObject.itemType === 'wall-h' || selectedObject.itemType === 'wall-v' ? 1 : 2;
            selectedObject.setStrokeStyle(strokeWidth, selectedObject.config.strokeColor);
        }
    }
    
    // เลือกใหม่
    selectedObject = object;
    if (object.itemType === 'custom-image') {
        // สร้าง outline สีเขียวรอบๆ รูปภาพ
        if (!object.selectionOutline) {
            const bounds = object.getBounds();
            const outline = scene.add.graphics();
            outline.lineStyle(3, 0x00ff00, 1);
            outline.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
            outline.setDepth(object.depth + 1);
            object.selectionOutline = outline;
            
            // อัพเดต outline เมื่อ object ถูกย้าย
            const updateOutline = () => {
                if (object.selectionOutline && object.active) {
                    const bounds = object.getBounds();
                    object.selectionOutline.clear();
                    object.selectionOutline.lineStyle(3, 0x00ff00, 1);
                    object.selectionOutline.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
                }
            };
            
            // อัพเดต outline เมื่อ object ถูกย้ายหรือ scale
            object.on('drag', updateOutline);
        }
    } else {
        object.setStrokeStyle(3, 0x00ff00); // สีเขียวสำหรับเลือก
    }
    
    // อัพเดต toolbar
    document.querySelectorAll('.item-button').forEach(btn => {
        btn.classList.remove('active');
    });
}

function selectObjectAt(scene, x, y) {
    const obj = getObjectAt(scene, x, y);
    if (obj) {
        selectObject(scene, obj);
    } else {
        // ยกเลิกการเลือก
        if (selectedObject) {
            if (selectedObject.itemType === 'custom-image') {
                // ลบ outline การเลือก
                if (selectedObject.selectionOutline) {
                    selectedObject.selectionOutline.destroy();
                    selectedObject.selectionOutline = null;
                }
            } else {
                const strokeWidth = selectedObject.itemType === 'wall-h' || selectedObject.itemType === 'wall-v' ? 1 : 2;
                selectedObject.setStrokeStyle(strokeWidth, selectedObject.config.strokeColor);
            }
            selectedObject = null;
        }
    }
}

function getObjectAt(scene, x, y) {
    // หาวัตถุที่อยู่ตำแหน่งนี้ (เรียงจากบนลงล่าง)
    const objects = placedObjects.filter(obj => {
        const bounds = obj.getBounds();
        return bounds.contains(x, y);
    });
    
    if (objects.length > 0) {
        // คืนค่าวัตถุที่มี depth สูงสุด (อยู่บนสุด)
        return objects.sort((a, b) => b.depth - a.depth)[0];
    }
    return null;
}

function deleteObject(scene, object) {
    const index = placedObjects.indexOf(object);
    if (index > -1) {
        placedObjects.splice(index, 1);
        // ลบ outline ถ้ามี
        if (object.selectionOutline) {
            object.selectionOutline.destroy();
        }
        object.destroy();
        if (selectedObject === object) {
            selectedObject = null;
        }
    }
}

function clearAllObjects(scene) {
    placedObjects.forEach(obj => obj.destroy());
    placedObjects = [];
    selectedObject = null;
}

function updateObjectTooltip(object) {
    if (object.selectedItem) {
        tooltipText.setText(`${object.selectedItem[0]}\n${object.selectedItem[1]}\n${object.selectedItem[2]}`);
    } else if (object.itemType === 'custom-image') {
        tooltipText.setText(`${object.imageData.name}\nRight-click to assign data`);
    } else {
        tooltipText.setText(`${object.itemType}\nRight-click to assign data`);
    }
}

function showDataSelection(scene, object) {
    if (!apiData || apiData.length === 0) return;

    let select = document.getElementById('dataSelect');
    if (select) {
        updateSelectPosition(select, scene, object);
        return;
    }

    select = document.createElement('select');
    select.id = 'dataSelect';
    select.style.position = 'absolute';
    select.style.zIndex = 1000;
    
    updateSelectPosition(select, scene, object);
    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.text = 'Select data...';
    select.appendChild(defaultOption);

    apiData.forEach((item, i) => {
        const option = document.createElement('option');
        option.value = i;
        option.text = `${item[0]} - ${item[1]} - ${item[2]}`;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        if (e.target.value === '') return;

        const index = parseInt(e.target.value);
        const item = apiData[index];
        
        // เปลี่ยนสีตามข้อมูล 5S
        if (object.itemType === 'custom-image') {
            // สำหรับ image ใช้ tint
            let tintColor = 0xffffff;
            switch (item[2]) {
                case "5S": tintColor = 0x00ff00; break;
                case "4S": tintColor = 0x99ff66; break;
                case "3S": tintColor = 0xffff00; break;
                case "2S": tintColor = 0xff9900; break;
                case "1S": tintColor = 0xff0000; break;
                case "0N": tintColor = 0x000000; break;
            }
            object.setTint(tintColor);
        } else {
            // สำหรับ rectangle ใช้ fill
            let color = object.config.color;
            switch (item[2]) {
                case "5S": color = 0x00ff00; break;
                case "4S": color = 0x99ff66; break;
                case "3S": color = 0xffff00; break;
                case "2S": color = 0xff9900; break;
                case "1S": color = 0xff0000; break;
                case "0N": color = 0x000000; break;
            }
            object.setFillStyle(color);
        }
        
        object.selectedItem = item;
        updateObjectTooltip(object);
        
        if (document.body.contains(select)) select.remove();
    });

    select.addEventListener('blur', () => {
        if (document.body.contains(select)) select.remove();
    });

    document.body.appendChild(select);
    select.focus();
}

function updateSelectPosition(select, scene, object) {
    const canvas = scene.sys.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const left = rect.left + object.x - 40;
    const top = rect.top + object.y - 20;
    select.style.left = `${left}px`;
    select.style.top = `${top}px`;
}

async function fetch5SData() {
    const url = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLi7xd-OAAmZ8AescjJL34a8FCTvhUUU9SkhzWKZrqoH8lkKJgP0nSmeO9uJKgaVgznwq8smArQemYEWgNSbnRoJZ3XSVmB4evh-Gnp1Fm1RxnVjk1jlGct9ATAqO_-x-p1Z43TfJgIIWQu0A2Fbxz8ZTIRzQRvCd2CoiqAsAbQ00hz6-NAOhTjrEJOUdsemb41OJe-QD8M7udfihqf9_eSwCWGJXN8UqSjKf7jXLwVPDr7iQ1vlCAbzOaYkGiVuLS2asvY8MWtONgLUI1ebQH173U5hKJjFkpiEMBEi&lib=M-g_o_A83U2A5xS2kBj8I5jgMzyICubym";
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Response status: ${response.status}`);
        const result = await response.json();
        return result.data;
    } catch (err) {
        console.error(err);
        return [];
    }
}

