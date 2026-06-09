using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

// =====================================================================
// Master-data read controllers — light wrappers over Dapper.
// All keys are uid. Writes for master data come exclusively via ETL
// (Commission.Api.Etl) — these controllers are read-only.
// =====================================================================

[ApiController]
[Route("api/organizations")]
public class OrganizationsController : ControllerBase
{
    private readonly IDb _db;
    public OrganizationsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM organizations WHERE is_active = TRUE ORDER BY org_name"));
}

[ApiController]
[Route("api/sales-offices")]
public class SalesOfficesController : ControllerBase
{
    private readonly IDb _db;
    public SalesOfficesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? orgUid) =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM sales_offices" +
            (orgUid != null ? " WHERE org_uid = @o" : "") +
            " ORDER BY name",
            new { o = orgUid }));
}

[ApiController]
[Route("api/employees")]
public class EmployeesController : ControllerBase
{
    private readonly IDb _db;
    public EmployeesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List()
        => Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM employees WHERE is_active = TRUE ORDER BY name"));

    [HttpGet("{uid}")]
    public async Task<IActionResult> Get(string uid)
    {
        var row = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM employees WHERE uid = @uid", new { uid });
        return row is null ? NotFound(new { error = "Employee not found" }) : Ok(row);
    }
}

[ApiController]
[Route("api/roles")]
public class RolesController : ControllerBase
{
    private readonly IDb _db;
    public RolesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM roles WHERE is_active = TRUE ORDER BY role_name_en"));
}

[ApiController]
[Route("api/currency")]
public class CurrencyController : ControllerBase
{
    private readonly IDb _db;
    public CurrencyController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync("SELECT * FROM currency ORDER BY code"));

    [HttpGet("exchange-rates")]
    public async Task<IActionResult> Rates() =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM exchange_rate WHERE is_active = TRUE ORDER BY effective_date DESC"));
}

[ApiController]
[Route("api/products")]
public class ProductsController : ControllerBase
{
    private readonly IDb _db;
    public ProductsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? category)
    {
        var sql = "SELECT * FROM products WHERE is_active = TRUE" +
                  (category != null ? " AND category_name = @cat" : "") +
                  " ORDER BY name";
        return Ok(await _db.QueryDynamicAsync(sql, new { cat = category }));
    }
}

[ApiController]
[Route("api/product-groups")]
public class ProductGroupsController : ControllerBase
{
    private readonly IDb _db;
    public ProductGroupsController(IDb db) { _db = db; }

    [HttpGet("types")]
    public async Task<IActionResult> Types() =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM product_group_types ORDER BY level_no, name"));

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? typeUid) =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM product_groups" +
            (typeUid != null ? " WHERE product_group_type_uid = @t" : "") +
            " ORDER BY name",
            new { t = typeUid }));
}

[ApiController]
[Route("api/customers")]
public class CustomersController : ControllerBase
{
    private readonly IDb _db;
    public CustomersController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM customers WHERE is_active = TRUE AND is_blocked = FALSE ORDER BY name LIMIT 1000"));
}

[ApiController]
[Route("api/customer-groups")]
public class CustomerGroupsController : ControllerBase
{
    private readonly IDb _db;
    public CustomerGroupsController(IDb db) { _db = db; }

    [HttpGet("types")]
    public async Task<IActionResult> Types() =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM customer_group_types ORDER BY level_no, name"));

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? typeUid) =>
        Ok(await _db.QueryDynamicAsync(
            "SELECT * FROM customer_groups" +
            (typeUid != null ? " WHERE customer_group_type_uid = @t" : "") +
            " ORDER BY name",
            new { t = typeUid }));
}

[ApiController]
[Route("api/transactions")]
public class TransactionsController : ControllerBase
{
    private readonly IDb _db;
    public TransactionsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? period,
        [FromQuery] string? empUid,
        [FromQuery] int? limit)
    {
        var lim = Math.Min(limit ?? 100, 1000);
        var clauses = new List<string>();
        var args = new Dictionary<string, object>();
        if (period != null) { clauses.Add("t.period = @p"); args["p"] = period; }
        if (empUid != null) { clauses.Add("t.emp_uid = @e"); args["e"] = empUid; }
        var where = clauses.Count == 0 ? "" : " WHERE " + string.Join(" AND ", clauses);

        return Ok(await _db.QueryDynamicAsync($@"
            SELECT t.*,
                   e.name AS employee_name,
                   c.name AS customer_name, c.code AS customer_code,
                   p.name AS product_name,  p.code AS product_code
            FROM transactions t
            JOIN employees e ON t.emp_uid = e.uid
            LEFT JOIN customers c ON t.customer_uid = c.uid
            LEFT JOIN products  p ON t.product_uid  = p.uid
            {where}
            ORDER BY t.transaction_date DESC LIMIT {lim}", args));
    }
}

// ----- Lookups (filter-values for FormulaBuilder) -----
[ApiController]
[Route("api/lookups")]
public class LookupsController : ControllerBase
{
    private readonly IDb _db;
    public LookupsController(IDb db) { _db = db; }

    [HttpGet("filter-values")]
    public async Task<IActionResult> FilterValues([FromQuery] string field)
    {
        return field switch
        {
            "product_brand" => Ok((await _db.QueryDynamicAsync(@"
                SELECT pg.uid, pg.code, pg.name
                FROM product_groups pg
                JOIN product_group_types pgt ON pg.product_group_type_uid = pgt.uid
                WHERE pgt.code = 'BRAND' OR pgt.name ILIKE 'brand%'
                ORDER BY pg.name"))
                .Select(g => new { value = (string)g.uid, label = g.code != null ? $"{g.code} — {g.name}" : (string)g.name })),

            "product_category" => Ok((await _db.QueryDynamicAsync(@"
                SELECT pg.uid, pg.code, pg.name
                FROM product_groups pg
                JOIN product_group_types pgt ON pg.product_group_type_uid = pgt.uid
                WHERE pgt.code = 'CATEGORY' OR pgt.name ILIKE 'category%'
                ORDER BY pg.name"))
                .Select(g => new { value = (string)g.uid, label = g.code != null ? $"{g.code} — {g.name}" : (string)g.name })),

            "product_subcategory" => Ok((await _db.QueryDynamicAsync(@"
                SELECT pg.uid, pg.code, pg.name
                FROM product_groups pg
                JOIN product_group_types pgt ON pg.product_group_type_uid = pgt.uid
                WHERE pgt.code = 'SUBCATEGORY' OR pgt.name ILIKE 'subcategory%'
                ORDER BY pg.name"))
                .Select(g => new { value = (string)g.uid, label = g.code != null ? $"{g.code} — {g.name}" : (string)g.name })),

            "product_sku" => Ok((await _db.QueryDynamicAsync(
                "SELECT uid, code, name FROM products WHERE is_active = TRUE ORDER BY name LIMIT 500"))
                .Select(p => new { value = (string)p.uid, label = $"{p.code} — {p.name}" })),

            "customer_channel" => Ok((await _db.QueryDynamicAsync(@"
                SELECT cg.uid, cg.code, cg.name
                FROM customer_groups cg
                JOIN customer_group_types cgt ON cg.customer_group_type_uid = cgt.uid
                WHERE cgt.code = 'CHANNEL' OR cgt.name ILIKE 'channel%'
                ORDER BY cg.name"))
                .Select(g => new { value = (string)g.uid, label = g.code != null ? $"{g.code} — {g.name}" : (string)g.name })),

            "customer_group" => Ok((await _db.QueryDynamicAsync(
                "SELECT uid, code, name FROM customer_groups ORDER BY name LIMIT 500"))
                .Select(g => new { value = (string)g.uid, label = g.code != null ? $"{g.code} — {g.name}" : (string)g.name })),

            "is_strategic" or "is_new_launch" => Ok(new[] {
                new { value = "true",  label = "Yes" },
                new { value = "false", label = "No"  } }),

            _ => Ok(Array.Empty<object>())
        };
    }
}
