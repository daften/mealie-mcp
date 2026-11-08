# Tools

## recipes

| Tool | Description |
|---|---|
| `get_current_user` | Shows which Mealie account this connection acts as, with its group and household. |
| `search_recipes` | Searches recipes by free text (`search`) and by `categories`, `tags`, `tools` and `foods`. Each filter takes IDs or slugs. Several values in one filter mean any of them, unless require_all is true. Returns summaries; use get_recipe for full details. |
| `get_recipe` | Gets one recipe in full, including ingredients, instructions and nutrition. |
| `create_recipe` | Creates a recipe from structured data. Ingredients with a food or unit need its id and name from list_foods / list_units; create missing ones first with create_food / create_unit. Quantities are decimals, and an ingredient that is not split into food and unit goes in note. To import from a web page, use import_recipe_from_url. Returns a short summary (id, slug, name, servings, tags, ingredient count, rating, image present); get_recipe has the full recipe. |
| `import_recipe_from_url` | Has Mealie scrape a recipe web page and create a recipe from it. Returns the new slug; use get_recipe to review what was imported. Some sites block the scraper (ah.be answers 403): the call then fails with an error, and the recipe has to be added with create_recipe instead. Mealie returns no import warnings, so check the result. |
| `update_recipe` | Changes the given fields of a recipe and leaves the rest alone. List fields (ingredients, instructions, notes, categories, tags, tools) are replaced as a whole, so send the complete list. Ingredient rules are the same as in create_recipe: food and unit need id and name from list_foods / list_units, quantities are decimals, unparsed text goes in note. Returns a short summary; get_recipe has the full recipe. |
| `duplicate_recipe` | Copies a recipe, optionally under a new name. |
| `mark_recipe_made` | Records that a recipe was made, today by default. |
| `rate_recipe` | Sets the rating (0 to 5) or favorite flag of the account this connection acts as, and replaces that account's earlier rating. Ratings are per user: there is no way to read or set another user's rating. |
| `delete_recipe` | Permanently deletes a recipe. |

## recipe-assets

| Tool | Description |
|---|---|
| `set_recipe_image_from_url` | Has Mealie download an image and use it as the recipe image. |
| `upload_recipe_image` | Replaces the recipe image with an uploaded file, up to about 12 MB. |
| `delete_recipe_image` | Removes the image from a recipe. |
| `upload_recipe_asset` | Attaches a file, such as a PDF of the original recipe, up to about 12 MB. |

## ingredients

| Tool | Description |
|---|---|
| `parse_ingredients` | Uses Mealie's parser to split free-text ingredient lines into quantity, unit and food. It only reads: nothing is created, so a food or unit Mealie does not know may come back without an id. Create it with create_food / create_unit before using it in create_recipe. |
| `list_foods` | Lists or searches foods in Mealie's shared vocabulary. |
| `create_food` | Adds a food to Mealie's shared vocabulary. |
| `update_food` | Changes the given fields of a food. |
| `delete_food` | Permanently deletes a food. Ingredients using it lose the link. |
| `list_units` | Lists or searches units in Mealie's shared vocabulary. |
| `create_unit` | Adds a unit to Mealie's shared vocabulary. |
| `update_unit` | Changes the given fields of a unit. |
| `delete_unit` | Permanently deletes a unit. Ingredients using it lose the link. |

## organizers

| Tool | Description |
|---|---|
| `list_categories` | Lists or searches categories. |
| `list_unused_categories` | Lists categories that no recipe uses. |
| `create_category` | Creates a category. |
| `rename_category` | Renames a category. |
| `delete_category` | Permanently deletes a category and removes it from every recipe. |
| `list_tags` | Lists or searches tags. |
| `list_unused_tags` | Lists tags that no recipe uses. |
| `create_tag` | Creates a tag. |
| `rename_tag` | Renames a tag. |
| `delete_tag` | Permanently deletes a tag and removes it from every recipe. |
| `list_recipe_tools` | Lists or searches recipe tools. |
| `list_unused_recipe_tools` | Lists recipe tools that no recipe uses. |
| `create_recipe_tool` | Creates a recipe tool. |
| `rename_recipe_tool` | Renames a recipe tool. |
| `delete_recipe_tool` | Permanently deletes a recipe tool and removes it from every recipe. |

## cookbooks

| Tool | Description |
|---|---|
| `list_cookbooks` | Lists the household’s cookbooks. A cookbook is a saved recipe filter, so each one shows its query_filter_string. |
| `get_cookbook` | Gets one cookbook, including its recipe filter. |
| `create_cookbook` | Creates a cookbook: a named, saved recipe filter. For a "Freezer menu" of everything tagged freezer, create or find the tag, then pass its ID in tags. Recipes are matched by the filter and never added by hand. |
| `update_cookbook` | Changes the given fields of a cookbook and leaves the others alone. Giving any filter field replaces the whole existing filter. |
| `delete_cookbook` | Permanently deletes a cookbook. The recipes it showed are not touched. |

## shopping

| Tool | Description |
|---|---|
| `list_shopping_lists` | Lists the household's shopping lists. Use get_shopping_list for the items. |
| `get_shopping_list` | Gets a shopping list with all its items. |
| `create_shopping_list` | Creates an empty shopping list. |
| `rename_shopping_list` | Renames a shopping list. |
| `delete_shopping_list` | Permanently deletes a shopping list and its items. |
| `add_shopping_items` | Adds one or more items to a shopping list. |
| `update_shopping_item` | Changes the given fields of a shopping item, including ticking it off. |
| `delete_shopping_item` | Removes an item from its shopping list. |
| `add_recipe_to_shopping_list` | Adds a recipe's ingredients to a shopping list, scaled by a multiplier. |

## mealplans

| Tool | Description |
|---|---|
| `get_mealplans` | Lists meal plan entries for the household, optionally within a date range. |
| `get_todays_meals` | Gets today's meal plan entries. |
| `create_mealplan_entry` | Adds a meal to the plan: either a recipe, or a title and note for something without one. |
| `create_random_mealplan_entry` | Lets Mealie pick a recipe for a date, following the household's meal plan rules. |
| `update_mealplan_entry` | Changes the given fields of a meal plan entry. |
| `delete_mealplan_entry` | Removes an entry from the meal plan. |
