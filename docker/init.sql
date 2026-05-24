CREATE DATABASE IF NOT EXISTS tienda;
USE tienda;

CREATE TABLE clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  telefono VARCHAR(20),
  ciudad VARCHAR(80),
  fecha_registro DATE
);

CREATE TABLE categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL
);

CREATE TABLE productos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  precio DECIMAL(10,2) NOT NULL,
  stock INT DEFAULT 0,
  categoria_id INT,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

CREATE TABLE pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2),
  estado ENUM('pendiente','enviado','entregado','cancelado') DEFAULT 'pendiente',
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE pedido_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  producto_id INT NOT NULL,
  cantidad INT NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);

INSERT INTO clientes (nombre, email, telefono, ciudad, fecha_registro) VALUES
  ('Ana García',      'ana.garcia@email.com',    '555-1001', 'Madrid',      '2023-01-15'),
  ('Carlos López',    'carlos.lopez@email.com',  '555-1002', 'Barcelona',   '2023-02-20'),
  ('María Rodríguez', 'maria.rod@email.com',     '555-1003', 'Sevilla',     '2023-03-10'),
  ('Juan Martínez',   'juan.mtz@email.com',      '555-1004', 'Valencia',    '2023-04-05'),
  ('Laura Sánchez',   'laura.san@email.com',     '555-1005', 'Bilbao',      '2023-05-18'),
  ('Pedro Fernández', 'pedro.fern@email.com',    '555-1006', 'Zaragoza',    '2023-06-22'),
  ('Sofía Torres',    'sofia.torres@email.com',  '555-1007', 'Málaga',      '2023-07-30'),
  ('Diego Ruiz',      'diego.ruiz@email.com',    '555-1008', 'Murcia',      '2023-08-14');

INSERT INTO categorias (nombre) VALUES
  ('Electrónica'), ('Ropa'), ('Hogar'), ('Deportes'), ('Libros');

INSERT INTO productos (nombre, descripcion, precio, stock, categoria_id) VALUES
  ('Laptop Pro 15',      'Portátil de alto rendimiento 15"',      999.99, 25, 1),
  ('Mouse Inalámbrico',  'Mouse ergonómico Bluetooth',              29.99, 80, 1),
  ('Teclado Mecánico',   'Teclado RGB switches azules',             79.99, 45, 1),
  ('Monitor 27"',        'Monitor IPS 4K 144Hz',                  399.99, 15, 1),
  ('Auriculares BT',     'Auriculares inalámbricos noise cancel',   149.99, 30, 1),
  ('Camiseta Algodón',   'Camiseta 100% algodón tallas S-XXL',       19.99, 120, 2),
  ('Pantalón Jeans',     'Jeans slim fit varios colores',            49.99, 60, 2),
  ('Zapatillas Running', 'Zapatillas ligeras para correr',           89.99, 40, 2),
  ('Sartén Antiadherente','Sartén 28cm libre de PFAS',              34.99, 50, 3),
  ('Lámpara LED',        'Lámpara escritorio ajustable 3000K',       24.99, 70, 3),
  ('Bicicleta MTB',      'Bicicleta montaña 21 velocidades',        349.99, 8,  4),
  ('Colchoneta Yoga',    'Colchoneta antideslizante 6mm',            25.99, 55, 4),
  ('El Quijote',         'Edición ilustrada de lujo',               22.99, 35, 5),
  ('Aprende SQL',        'Guía práctica de bases de datos',          18.99, 40, 5);

INSERT INTO pedidos (cliente_id, fecha, total, estado) VALUES
  (1, '2024-01-10 10:30:00', 1029.98, 'entregado'),
  (2, '2024-01-15 14:20:00',  129.98, 'entregado'),
  (3, '2024-02-01 09:15:00',  349.99, 'enviado'),
  (4, '2024-02-14 16:45:00',   69.98, 'entregado'),
  (5, '2024-03-05 11:00:00',  149.99, 'pendiente'),
  (1, '2024-03-20 13:30:00',  479.98, 'enviado'),
  (6, '2024-04-01 08:50:00',   59.98, 'entregado'),
  (7, '2024-04-10 17:20:00',  422.98, 'pendiente'),
  (8, '2024-05-01 10:00:00',   43.98, 'cancelado'),
  (2, '2024-05-15 15:40:00',  399.99, 'enviado');

INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES
  (1,  1, 1, 999.99), (1,  2, 1,  29.99),
  (2,  6, 2,  19.99), (2,  7, 1,  49.99), (2,  8, 1,  89.99),
  (3, 11, 1, 349.99),
  (4,  6, 1,  19.99), (4, 12, 1,  25.99), (4, 13, 1,  22.99),
  (5,  5, 1, 149.99),
  (6,  4, 1, 399.99), (6,  9, 1,  34.99), (6, 10, 1,  24.99),
  (7,  7, 1,  49.99), (7,  8, 1,  89.99),
  (8,  4, 1, 399.99), (8, 11, 1, 349.99),
  (9,  9, 1,  34.99), (9, 14, 1,   9.99),
  (10, 4, 1, 399.99);
