export interface ShopifyImage {
  id?: number;
  position?: number;
  src: string;
  width?: number;
  height?: number;
  alt?: string | null;
}

export interface ShopifyOption {
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compare_at_price: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  position: number;
  requires_shipping: boolean;
  taxable: boolean;
  available: boolean;
  inventory_quantity: number;
  weight?: number;
  weight_unit?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string[];
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  options: ShopifyOption[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

export interface ShopifyCollection {
  id: number;
  handle: string;
  title: string;
  body_html: string | null;
  sort_order: string;
  published_at: string | null;
  updated_at: string;
  image: ShopifyImage | null;
}

export interface ShopifyCustomer {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  currency: string | null;
  tags: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyLineItem {
  id?: number;
  product_id?: number;
  variant_id?: number;
  title: string;
  quantity: number;
  price: string;
  sku?: string | null;
}

export interface ShopifyOrder {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  currency: string | null;
  subtotal_price: string;
  total_price: string;
  total_discounts: string;
  total_shipping: string | null;
  tags: string;
  customer?: ShopifyCustomer | null;
  customer_id?: number | null;
  line_items: ShopifyLineItem[];
  created_at: string;
  updated_at: string;
}