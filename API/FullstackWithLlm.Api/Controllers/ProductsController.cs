using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class ProductsController : ControllerBase
{
    private readonly ProductRepository _productRepository;

    public ProductsController(ProductRepository productRepository)
    {
        _productRepository = productRepository;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<Product>>> GetAll()
    {
        var products = await _productRepository.GetAllAsync();
        return Ok(products);
    }

    [HttpPost]
    public async Task<ActionResult<Product>> Create(Product product)
    {
        if (string.IsNullOrWhiteSpace(product.Name))
        {
            return BadRequest("Name is required.");
        }

        if (product.Price < 0)
        {
            return BadRequest("Price must be >= 0.");
        }

        var newId = await _productRepository.CreateAsync(product);
        product.Id = newId;

        return CreatedAtAction(nameof(GetAll), new { id = newId }, product);
    }
}
