create table industry_templates (
  code text primary key,           -- 'default','trade','construction','manufacturing'
  name text not null,
  ext_label text,                  -- 'Cửa hàng' | 'Công trình' | 'Dây chuyền' | null
  payload jsonb not null           -- {items:[...], extSamples:[...], extKey, accounts:[...]}
);
alter table industry_templates enable row level security;
-- Bảng dùng chung mọi tenant (không có tenant_id) — cho phép mọi người đăng nhập đọc để chọn mẫu.
create policy sel_industry_templates on industry_templates for select using (true);

insert into industry_templates (code, name, ext_label, payload) values
('default', 'Thương mại – dịch vụ (mặc định)', null, '{
  "extKey": null,
  "extSamples": [],
  "items": [
    {"code":"HH001","name":"Máy bơm nước","uom":"cái","cost":700000,"price":1000000,"kind":"goods"},
    {"code":"HH002","name":"Ống nhựa 27mm","uom":"m","cost":12000,"price":20000,"kind":"goods"},
    {"code":"DV001","name":"Dịch vụ lắp đặt","uom":"lần","cost":0,"price":500000,"kind":"service"}
  ],
  "accounts": [
    {"code":"111","name":"Tiền mặt"}, {"code":"112","name":"Tiền gửi ngân hàng"},
    {"code":"131","name":"Phải thu khách hàng"}, {"code":"133","name":"Thuế GTGT được khấu trừ"},
    {"code":"141","name":"Tạm ứng"}, {"code":"152","name":"Nguyên vật liệu"},
    {"code":"154","name":"Chi phí SXKD dở dang"}, {"code":"155","name":"Thành phẩm"},
    {"code":"156","name":"Hàng hoá"}, {"code":"331","name":"Phải trả người bán"},
    {"code":"3331","name":"Thuế GTGT phải nộp"}, {"code":"334","name":"Phải trả người lao động"},
    {"code":"411","name":"Vốn chủ sở hữu"}, {"code":"511","name":"Doanh thu bán hàng"},
    {"code":"632","name":"Giá vốn hàng bán"}, {"code":"642","name":"Chi phí quản lý"}
  ]
}'::jsonb),
('trade', 'Thương mại – phân phối', 'Cửa hàng', '{
  "extKey": "store",
  "extSamples": ["Cửa hàng Quận 1", "Cửa hàng Thủ Đức"],
  "items": [
    {"code":"HH001","name":"Máy bơm nước","uom":"cái","cost":700000,"price":1000000,"kind":"goods"},
    {"code":"HH002","name":"Ống nhựa 27mm","uom":"m","cost":12000,"price":20000,"kind":"goods"},
    {"code":"HH003","name":"Bình nước nóng","uom":"cái","cost":1800000,"price":2500000,"kind":"goods"}
  ],
  "accounts": [
    {"code":"111","name":"Tiền mặt"}, {"code":"112","name":"Tiền gửi ngân hàng"},
    {"code":"131","name":"Phải thu khách hàng"}, {"code":"133","name":"Thuế GTGT được khấu trừ"},
    {"code":"141","name":"Tạm ứng"}, {"code":"152","name":"Nguyên vật liệu"},
    {"code":"154","name":"Chi phí SXKD dở dang"}, {"code":"155","name":"Thành phẩm"},
    {"code":"156","name":"Hàng hoá"}, {"code":"331","name":"Phải trả người bán"},
    {"code":"3331","name":"Thuế GTGT phải nộp"}, {"code":"334","name":"Phải trả người lao động"},
    {"code":"411","name":"Vốn chủ sở hữu"}, {"code":"511","name":"Doanh thu bán hàng"},
    {"code":"632","name":"Giá vốn hàng bán"}, {"code":"642","name":"Chi phí quản lý"}
  ]
}'::jsonb),
('construction', 'Xây dựng – nhà thầu', 'Công trình', '{
  "extKey": "project",
  "extSamples": ["CT-01 Nhà xưởng Long An", "CT-02 Văn phòng Q7"],
  "items": [
    {"code":"VT001","name":"Xi măng PCB40","uom":"bao","cost":85000,"price":95000,"kind":"goods"},
    {"code":"VT002","name":"Thép D10","uom":"kg","cost":15500,"price":17000,"kind":"goods"},
    {"code":"DV002","name":"Nhân công lắp dựng","uom":"ngày","cost":0,"price":600000,"kind":"service"}
  ],
  "accounts": [
    {"code":"111","name":"Tiền mặt"}, {"code":"112","name":"Tiền gửi ngân hàng"},
    {"code":"131","name":"Phải thu khách hàng"}, {"code":"133","name":"Thuế GTGT được khấu trừ"},
    {"code":"141","name":"Tạm ứng"}, {"code":"152","name":"Nguyên vật liệu"},
    {"code":"154","name":"Chi phí SXKD dở dang"}, {"code":"155","name":"Thành phẩm"},
    {"code":"156","name":"Hàng hoá"}, {"code":"331","name":"Phải trả người bán"},
    {"code":"3331","name":"Thuế GTGT phải nộp"}, {"code":"334","name":"Phải trả người lao động"},
    {"code":"411","name":"Vốn chủ sở hữu"}, {"code":"511","name":"Doanh thu bán hàng"},
    {"code":"632","name":"Giá vốn hàng bán"}, {"code":"642","name":"Chi phí quản lý"}
  ]
}'::jsonb),
('manufacturing', 'Sản xuất – chế biến', 'Dây chuyền', '{
  "extKey": "line",
  "extSamples": ["Dây chuyền A", "Dây chuyền B"],
  "items": [
    {"code":"NL001","name":"Vỏ nhựa","uom":"cái","cost":20000,"price":0,"kind":"material"},
    {"code":"NL002","name":"Mô tơ 12V","uom":"cái","cost":120000,"price":0,"kind":"material"},
    {"code":"TP001","name":"Quạt mini","uom":"cái","cost":0,"price":300000,"kind":"finished","bom":[["NL001",1],["NL002",1]]}
  ],
  "accounts": [
    {"code":"111","name":"Tiền mặt"}, {"code":"112","name":"Tiền gửi ngân hàng"},
    {"code":"131","name":"Phải thu khách hàng"}, {"code":"133","name":"Thuế GTGT được khấu trừ"},
    {"code":"141","name":"Tạm ứng"}, {"code":"152","name":"Nguyên vật liệu"},
    {"code":"154","name":"Chi phí SXKD dở dang"}, {"code":"155","name":"Thành phẩm"},
    {"code":"156","name":"Hàng hoá"}, {"code":"331","name":"Phải trả người bán"},
    {"code":"3331","name":"Thuế GTGT phải nộp"}, {"code":"334","name":"Phải trả người lao động"},
    {"code":"411","name":"Vốn chủ sở hữu"}, {"code":"511","name":"Doanh thu bán hàng"},
    {"code":"632","name":"Giá vốn hàng bán"}, {"code":"642","name":"Chi phí quản lý"}
  ]
}'::jsonb);
