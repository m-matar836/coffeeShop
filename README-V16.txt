V16 - final requested structure

Sales:
product | price | quantity | discount % | notes | total after discount | action
Discount is a percentage entered as a number (e.g. 10 = 10%).

Waste:
item | quantity | action

Removed from UI:
- Expenses
- Separate "sales with discount" section
- Barcode/USB/camera features

Gifts:
item | quantity | notes | action

Price:
Changing a sales price sends updateProductPrice to Apps Script after a short debounce and refreshes the app cache after success.

Backend:
Use Code.gs in this package. Deploy a new Apps Script version after replacing Code.gs.
